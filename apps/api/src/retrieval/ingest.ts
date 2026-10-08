import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { StateRuleSchema, type StateRule } from '@fintech-agent/contracts';
import { parse } from 'yaml';
import { z } from 'zod';

import { detectPromptInjection } from '../guard/prompt-guard.js';

const MANIFEST_FILE = 'manifest.json';
const POLICY_EXTENSION = '.md';
// Spanish runs about 3.5 characters a token.
const MAX_CHUNK_CHARS_AT_350_TOKENS = 1_225;
const DOC_ID_PREFIX = 'pol-';
// Two digits and an optional letter (pol-09b), so every chunk id is unique.
const DOC_ID = /^pol-\d{2}[a-z]?$/;
const CHUNK_ID_PREFIX = 'chunk_p';
const SECTION_MARK = 's';
const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n/;
// Only a newline starts a line: CommonMark draws no line at U+2028/2029.
const SECTION_HEADING = /(?<![^\n])## ([^\n]+)/g;
// What rendered Markdown hides from a reviewer: comments, bogus comments,
// CDATA, processing instructions and link reference definitions. An
// unterminated one hides the rest of the doc, so it runs to the end.
const HIDDEN_MARKUP =
  /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<![\s\S]*?(?:>|$)|<\?[\s\S]*?(?:\?>|$)|(?<![^\n]) {0,3}\[[^\]\n]+\]:[^\n]*/g;
// A policy is plain prose. Raw HTML, character references, links, images,
// reference definitions, footnotes, fences, blockquotes, tables (GFM drops a
// cell past the header) and math (`\phantom` typesets blank) can each hide
// text from a reviewer of the rendered file, in any position, so the syntax
// itself quarantines rather than a list of the ways it hides text.
const NOT_PLAIN_PROSE = /[<[\]`|$\\]|~~~|&#?[A-Za-z0-9]+;|(?<![^\n])[ \t]*>/;
// Zero-width, bidi, Tags, variation selectors, fillers, line separators and
// the Braille blank: no legitimate policy holds one, and each can hide or
// smuggle text past a reviewer (02 G8).
const INVISIBLE_CHAR =
  /\p{Default_Ignorable_Code_Point}|\p{Cf}|\p{Zl}|\p{Zp}|\u2800|(?![\n\t])\p{Cc}/u;
const INVISIBLE_CHARS = new RegExp(INVISIBLE_CHAR.source, 'gu');
const SHA256_HEX = /^[0-9a-f]{64}$/;

const ManifestEntrySchema = z.strictObject({
  doc_id: z.string().regex(DOC_ID),
  title: z.string().min(1),
  file: z
    .string()
    .endsWith(POLICY_EXTENSION)
    .regex(/^[\w.-]+$/),
  keywords: z.array(z.string().min(1)),
  sha256: z.string().regex(SHA256_HEX),
});

const PolicyManifestSchema = z.strictObject({
  docs: z.array(ManifestEntrySchema).min(1),
});
/** `data/policies/manifest.json`: the reviewed list of policy files (02 G8). */
export type PolicyManifest = z.infer<typeof PolicyManifestSchema>;

const FrontMatterSchema = z.strictObject({
  doc_id: z.string(),
  title: z.string(),
  synthetic: z.literal(true),
  sources: z.array(z.string().min(1)),
  state_rules: z
    .array(
      z.strictObject({ section: z.string().min(1), rule: StateRuleSchema }),
    )
    .default([]),
});

/** One `policy_chunks` row before it is written. */
export interface IngestedChunk {
  id: string;
  docId: string;
  section: string;
  /** The normalized text, the only text retrieval returns (02 G8). */
  content: string;
  keywords: string;
  stateRules: StateRule[];
  contentHash: string;
  quarantined: boolean;
}

/** The corpus is refused whole: `seed` fails rather than serve a stale or tampered policy. */
export class CorpusRefusedError extends Error {
  constructor(reason: string) {
    super(`policy corpus refused: ${reason}`);
    this.name = 'CorpusRefusedError';
  }
}

const sha256 = (text: string): string =>
  createHash('sha256').update(text).digest('hex');

const normalize = (text: string): string =>
  text.normalize('NFC').replace(INVISIBLE_CHARS, '').trim();

const flagged = (text: string): boolean => !detectPromptInjection(text).safe;

// A parser's message quotes the offending source line; the seed logs the
// refusal, so only the file name leaves.
function parsedOrRefused(read: () => unknown, file: string): unknown {
  try {
    return read();
  } catch {
    throw new CorpusRefusedError(`${file} does not parse`);
  }
}

function parseOrRefuse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  what: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    // Issue codes and paths only: a message would quote the file's text.
    const issues = result.error.issues
      .map(({ code, path }) => `${code} at ${path.join('.') || 'root'}`)
      .join('; ');
    throw new CorpusRefusedError(`${what}: ${issues}`);
  }
  return result.data;
}

interface Section {
  heading: string;
  raw: string;
  // The body with all hidden markup cut out, wherever it began.
  visible: string;
  inHiddenMarkup: boolean;
}

type Range = readonly [start: number, end: number];

// Hidden markup is found on the whole body, since a comment may open in a
// section and close several headings later.
const hiddenRanges = (body: string): Range[] =>
  [...body.matchAll(HIDDEN_MARKUP)].map((match): Range => [
    match.index,
    match.index + match[0].length,
  ]);

function outside(body: string, [start, end]: Range, cuts: Range[]): string {
  let text = '';
  let from = start;
  for (const [cutStart, cutEnd] of cuts) {
    if (cutEnd <= from || cutStart >= end) continue;
    text += body.slice(from, Math.max(from, cutStart));
    from = Math.min(end, Math.max(from, cutEnd));
  }
  return text + body.slice(from, end);
}

function sectionsOf(body: string, file: string): Section[] {
  const headings = [...body.matchAll(SECTION_HEADING)];
  const first = headings[0];
  if (first === undefined || body.slice(0, first.index).trim() !== '') {
    throw new CorpusRefusedError(`${file} has text outside a "## " section`);
  }
  const hidden = hiddenRanges(body);
  return headings.map((heading, index) => {
    const start = heading.index;
    const end = headings[index + 1]?.index ?? body.length;
    const bodyStart = start + heading[0].length;
    return {
      heading: heading[1] ?? '',
      raw: body.slice(bodyStart, end),
      visible: outside(body, [bodyStart, end], hidden),
      inHiddenMarkup: hidden.some(([from, to]) => from < end && to > start),
    };
  });
}

function chunksOf(
  entry: z.infer<typeof ManifestEntrySchema>,
  text: string,
): IngestedChunk[] {
  const front = FRONT_MATTER.exec(text);
  if (front === null) {
    throw new CorpusRefusedError(`${entry.file} has no front matter`);
  }
  const meta = parseOrRefuse(
    FrontMatterSchema,
    parsedOrRefused(() => parse(front[1] ?? '') as unknown, entry.file),
    entry.file,
  );
  if (meta.doc_id !== entry.doc_id || meta.title !== entry.title) {
    throw new CorpusRefusedError(`${entry.file} disagrees with the manifest`);
  }
  const sections = sectionsOf(text.slice(front[0].length), entry.file);
  const headings = sections.map(({ heading }) => normalize(heading));
  for (const { section } of meta.state_rules) {
    if (!headings.includes(section)) {
      throw new CorpusRefusedError(
        `${entry.file} has a rule for a missing section`,
      );
    }
  }
  const docKey = entry.doc_id.slice(DOC_ID_PREFIX.length);
  return sections.map(({ heading, raw, visible, inHiddenMarkup }, index) => {
    const section = headings[index] ?? '';
    const content = normalize(visible);
    if (content.length > MAX_CHUNK_CHARS_AT_350_TOKENS) {
      throw new CorpusRefusedError(
        `${entry.file} section ${index + 1} is over the chunk budget`,
      );
    }
    const whole = `${heading}\n${raw}`;
    return {
      id: `${CHUNK_ID_PREFIX}${docKey}${SECTION_MARK}${index + 1}`,
      docId: entry.doc_id,
      section,
      content,
      keywords: entry.keywords.join(', '),
      stateRules: meta.state_rules
        .filter((rule) => rule.section === section)
        .map(({ rule }) => rule),
      contentHash: sha256(content),
      quarantined:
        inHiddenMarkup ||
        NOT_PLAIN_PROSE.test(whole) ||
        // NFC can complete syntax the raw text lacked (U+037E becomes ";").
        NOT_PLAIN_PROSE.test(`${section}\n${content}`) ||
        INVISIBLE_CHAR.test(whole) ||
        flagged(whole) ||
        flagged(`${section}\n${content}`),
    };
  });
}

/**
 * Turns the manifest and the policy files into chunks (02 G8): refuses a
 * file the manifest does not list, an entry with no file, a changed hash or
 * a malformed doc or a title the guard flags (titles reach every run);
 * quarantines a chunk the guard flags on its raw or normalized text, any
 * section hidden markup touches (an HTML comment and its kin), any chunk
 * that is not plain prose, and any chunk holding an invisible character
 * (02 G8).
 */
export function ingestPolicies(
  input: PolicyManifest,
  files: ReadonlyMap<string, string>,
): IngestedChunk[] {
  const manifest = parseOrRefuse(PolicyManifestSchema, input, MANIFEST_FILE);
  const listed = new Set(manifest.docs.map(({ file }) => file));
  const ids = new Set(manifest.docs.map(({ doc_id }) => doc_id));
  if (listed.size !== manifest.docs.length || ids.size !== listed.size) {
    throw new CorpusRefusedError('the manifest repeats a doc');
  }
  for (const file of files.keys()) {
    if (!listed.has(file)) {
      throw new CorpusRefusedError(`${file} is not in the manifest`);
    }
  }
  return manifest.docs.flatMap((entry) => {
    if (INVISIBLE_CHAR.test(entry.title) || flagged(entry.title)) {
      throw new CorpusRefusedError(
        `${entry.file} has a title the guard refuses`,
      );
    }
    const text = files.get(entry.file);
    if (text === undefined) {
      throw new CorpusRefusedError(`${entry.file} is missing`);
    }
    if (sha256(text) !== entry.sha256) {
      throw new CorpusRefusedError(`${entry.file} does not match its hash`);
    }
    return chunksOf(entry, text);
  });
}

/** Reads `manifest.json` from the policies directory. */
export function loadManifest(dir: string): PolicyManifest {
  return parseOrRefuse(
    PolicyManifestSchema,
    parsedOrRefused(
      () =>
        JSON.parse(readFileSync(join(dir, MANIFEST_FILE), 'utf8')) as unknown,
      MANIFEST_FILE,
    ),
    MANIFEST_FILE,
  );
}

/** Reads every policy file in `dir` and ingests it against the manifest. */
export function loadCorpus(dir: string): IngestedChunk[] {
  const files = new Map(
    readdirSync(dir)
      .filter((file) => file.endsWith(POLICY_EXTENSION))
      .map((file) => [file, readFileSync(join(dir, file), 'utf8')]),
  );
  return ingestPolicies(loadManifest(dir), files);
}
