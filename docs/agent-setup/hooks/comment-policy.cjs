#!/usr/bin/env node
// Claude Code PreToolUse hook (Edit|Write|MultiEdit): enforces the
// minimal-comments policy of ~/.claude/rules/comments.md in every repo.
//
// Default-deny. A comment survives only as JSDoc, a TODO/FIXME/HACK, a tooling
// pragma, or a line that states an actual reason. A density cap keeps even the
// justified ones scarce. Exit 2 + stderr blocks the write; exit 0 allows it.

'use strict';

const fs = require('fs');
const path = require('path');

const allow = () => process.exit(0);

let payload;
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  allow();
}

const input = payload.tool_input || {};
const filePath = input.file_path || '';
if (!filePath) allow();

const cwd = payload.cwd || '';
const abs = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
const ext = path.extname(abs).toLowerCase();

const SKIP_PATH = [
  /\/node_modules\//,
  /\/dist\//,
  /\/build\//,
  /\/coverage\//,
  /\/\.claude\//,
  /\/\.superpowers\//,
  /\/docs\/superpowers\//,
  /\.gen\.[tj]sx?$/,
  /routeTree\.gen\./,
  /\.d\.ts$/,
];
if (SKIP_PATH.some((re) => re.test(abs))) allow();

const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const isCode = CODE_EXTS.has(ext);
const isMarkdown = ext === '.md';
if (!isCode && !isMarkdown) allow();

let added = '';
let before = '';
if (payload.tool_name === 'Write') {
  added = input.content || '';
  try {
    before = fs.readFileSync(abs, 'utf8');
  } catch {
    before = '';
  }
} else if (payload.tool_name === 'MultiEdit') {
  added = (input.edits || []).map((e) => e.new_string || '').join('\n');
  before = (input.edits || []).map((e) => e.old_string || '').join('\n');
} else {
  added = input.new_string || '';
  before = input.old_string || '';
}
if (!added.trim()) allow();

const untouched = new Set(
  before
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
);

const EPHEMERAL =
  /(\bTF-\d+|\bJIRA-\d+|\btask\s*#?\d|\bpr\s*#?\d|#\d{2,}|(?:fix(?:es|ed)?|closes?|refs?|see|per|added (?:for|in)|changed per)\s+#\d|per (?:cr|code[- ]?review|review|feedback)|as requested)/i;

const violations = [];
const flag = (text, why) =>
  violations.push(`  • ${String(text).trim().slice(0, 76)} — ${why}`);

// En Markdown una referencia a un issue/PR es contenido legítimo (CHANGELOG, cuerpo
// de PR, runbook). Solo la charla efímera de proceso sobra aquí.
const EPHEMERAL_MD =
  /(per (?:cr|code[- ]?review|review|feedback)|as requested|changed per)/i;

if (isMarkdown) {
  for (const line of added.split('\n')) {
    if (EPHEMERAL_MD.test(line)) {
      flag(line, 'ephemeral reference — keep it in the commit message or PR body');
    }
  }
  report();
}

const PRAGMA =
  /(eslint-disable|eslint-enable|@ts-|biome-ignore|prettier-ignore|c8 ignore|istanbul ignore|v8 ignore|@vitest-|<reference |webpackChunkName|@jsx|use client|use server)/;
const TRACKER = /^\s*(TODO|FIXME|HACK|XXX)\b/i;
const RATIONALE =
  /\b(because|since|due to|so|otherwise|unless|or else|but|however|though|although|without|would|must|may|can|cannot|can't|won't|doesn't|does not|too|never|always|still|no longer|workaround|quirk|bug|instead|beware|caveat|assumes?|invariant|deliberate|intentional|requires?|expects?|relies|depends?|prevents?|avoids?|breaks?|fails?|overrides?|ignores?|silently|stale|mismatch|unreliable|unsafe|upstream|race|ordering|known issue|edge case|in practice|turns out|observed|not supported|only works|only way|has to|unlike|despite|even though|per spec|by design|safari|firefox|chrome|legacy api)\b/i;
const DIVIDER = /^\s*[-=*_#~]{3,}|[-=*_#~]{3,}\s*$/;
const STAMP = /^\s*[A-Za-z][A-Za-z.]*\.?\s*\d{4}([-/]\d{2}){0,2}\s*$/;
const TOMBSTONE =
  /^\s*(removed|deleted|old (logic|code|impl|implementation|version)|kept for reference|commented[- ]out|legacy:|was:|previously)/i;

const MAX_COMMENT_LINES = 6;
const MAX_LITERAL_LABEL_WORDS = 3;

function tokenize(text) {
  const lines = text.split('\n');
  const codeLine = new Array(lines.length).fill(false);
  const comments = [];
  let state = 'code';
  let buf = '';
  let start = 0;
  let doc = false;
  let line = 0;

  const push = (type) => {
    if (buf.trim()) {
      comments.push({ type, doc, text: buf.trim(), start, end: line });
    }
    buf = '';
    doc = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];

    if (c === '\n') {
      if (state === 'line') {
        push('line');
        state = 'code';
      } else if (state === 'block') {
        buf += '\n';
      } else if (state !== 'tpl') {
        state = 'code';
      }
      line += 1;
      continue;
    }

    if (state === 'line' || state === 'block') {
      if (state === 'block' && c === '*' && next === '/') {
        push('block');
        state = 'code';
        i += 1;
        continue;
      }
      buf += c;
      continue;
    }

    if (state === 'sq' || state === 'dq' || state === 'tpl') {
      if (c === '\\') {
        i += 1;
        continue;
      }
      if (
        (state === 'sq' && c === "'") ||
        (state === 'dq' && c === '"') ||
        (state === 'tpl' && c === '`')
      ) {
        state = 'code';
      }
      continue;
    }

    if (c === '/' && next === '/') {
      state = 'line';
      start = line;
      i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      state = 'block';
      doc = text[i + 2] === '*';
      start = line;
      i += 2;
      continue;
    }
    if (c === "'") state = 'sq';
    else if (c === '"') state = 'dq';
    else if (c === '`') state = 'tpl';
    else if (!/\s/.test(c)) codeLine[line] = true;
  }
  if (state === 'line') push('line');

  const merged = [];
  for (const c of comments) {
    const prev = merged[merged.length - 1];
    const contiguous =
      prev &&
      prev.type === 'line' &&
      c.type === 'line' &&
      c.start === prev.end + 1 &&
      !codeLine[prev.start] &&
      !codeLine[c.start];
    if (contiguous) {
      prev.text += ' ' + c.text;
      prev.end = c.end;
    } else {
      merged.push({ ...c });
    }
  }

  return {
    lines,
    comments: merged,
    codeLine,
    codeCount: codeLine.filter(Boolean).length,
  };
}

const STOPWORDS = new Set(
  'the a an to of for and or if is are be this that it its in on at we should will with from by as not no then so into via when which their they them our all each any new here there do does done use used using one only'.split(
    ' '
  )
);
const stem = (w) =>
  w
    .replace(/ies$/, 'y')
    .replace(/(sses|shes|ches|xes)$/, (m) => m.slice(0, -2))
    .replace(/s$/, '')
    .replace(/(ing|ed|er|or)$/, '');
const words = (t) =>
  t
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .map(stem);

const identifierWords = (code) => {
  const out = new Set();
  for (const id of code.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? []) {
    for (const part of id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[_$\s]+/)) {
      if (part.length > 2) out.add(stem(part.toLowerCase()));
    }
  }
  return out;
};

const { lines, comments, codeLine, codeCount } = tokenize(added);

const codeAfter = (end) => {
  const out = [];
  for (let j = end + 1; j < lines.length && out.length < 2; j += 1) {
    const t = lines[j].trim();
    if (t === '') break;
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    out.push(t);
  }
  return out.join(' ');
};

let justified = 0;

const isPreexisting = (c) => {
  for (let i = c.start; i <= c.end; i += 1) {
    const t = (lines[i] ?? '').trim();
    if (t && !untouched.has(t)) return false;
  }
  return true;
};

for (const c of comments) {
  if (isPreexisting(c)) continue;

  const body = c.text.replace(/^\*+\s?/gm, '').replace(/\s+/g, ' ').trim();
  if (!body) continue;

  if (PRAGMA.test(c.text)) continue;

  if (EPHEMERAL.test(body)) {
    flag(body, 'task/PR/issue reference — it belongs in the commit message, not the code');
    continue;
  }
  if (DIVIDER.test(body)) {
    flag(body, 'section divider — use whitespace and module structure instead');
    continue;
  }
  if (STAMP.test(body)) {
    flag(body, 'author/date stamp — git blame is authoritative');
    continue;
  }
  if (TOMBSTONE.test(body)) {
    flag(body, 'tombstone — delete the dead code, git keeps the history');
    continue;
  }

  if ((body.match(/[A-Za-z]{2,}/g) ?? []).length === 0) continue;
  if (TRACKER.test(body)) continue;

  const labelsALiteral =
    codeLine[c.start] &&
    (body.match(/[^\s]+/g) ?? []).length <= MAX_LITERAL_LABEL_WORDS;
  if (labelsALiteral) continue;

  if (c.doc) {
    const cw = words(body);
    const ids = identifierWords(codeAfter(c.end));
    const shared = cw.filter((w) => ids.has(w));
    if (
      !RATIONALE.test(body) &&
      cw.length > 0 &&
      cw.length <= 6 &&
      shared.length >= 2 &&
      shared.length / cw.length >= 0.6
    ) {
      flag(`/** ${body}`, 'JSDoc that only respells the signature — state what a caller cannot infer, or drop it');
    }
    continue;
  }

  const span = c.end - c.start + 1;
  if (c.type === 'block' && span > 1) {
    flag(body, 'multi-line /* */ block — use // line comments (Google TS style guide)');
    continue;
  }
  if (span > MAX_COMMENT_LINES) {
    flag(body, `${span}-line comment — state the constraint in a couple of lines and move the prose to the PR description`);
    continue;
  }

  if (!RATIONALE.test(body)) {
    flag(body, 'states what the code does, not why — delete it, or rewrite it around the constraint that makes the code non-obvious');
    continue;
  }

  justified += 1;
}

const budget = Math.max(2, Math.floor(codeCount / 12));
if (justified > budget) {
  violations.push(
    `  • ${justified} explanatory comments over ${codeCount} lines of code — the budget is ${budget}; keep only the ones a reader would be stuck without`
  );
}

report();

function report() {
  if (violations.length === 0) allow();
  const rel = cwd && abs.startsWith(cwd) ? abs.slice(cwd.length + 1) : abs;
  const shown = [...new Set(violations)].slice(0, 8).join('\n');
  process.stderr.write(
    `Minimal-comments policy (~/.claude/rules/comments.md) blocked this write.\n` +
      `File: ${rel}\n${shown}\n\n` +
      `The default is no comment at all. One survives only as: JSDoc on an exported API, ` +
      `a TODO/FIXME/HACK, a tooling pragma, or a single line naming the hidden constraint ` +
      `(the quirk, invariant, bug, or trade-off) that makes the code look wrong. ` +
      `If the comment explains WHAT the code does, rename something or extract a function instead. ` +
      `Remove or rewrite the lines above, then retry.\n`
  );
  process.exit(2);
}
