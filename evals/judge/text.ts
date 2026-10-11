import type { JudgeInput } from '@fintech-agent/api/evals';

const JSON_INDENT = 2;
const BLOCK_BREAK = '\n\n';
const NOTHING = '(none)';
const DRAFT_HEADING = 'DRAFT REPLY';

/**
 * What a run that persisted no reply answers instead of a draft: it has
 * nothing to ground, so the judge never reads it (03 §Judge validation).
 * Every judged text opens with the draft heading, so none can equal it.
 */
export const NO_REPLY =
  'NO REPLY: the run persisted none, so there is nothing to judge.';

/**
 * What the groundedness judge reads for one draft (03 §Judge validation):
 * the draft, the cited policy chunks and the masked tool outputs, never the
 * label or the case's expected action; `NO_REPLY` without a judge input.
 */
export function judgeText(input: JudgeInput | null): string {
  if (input === null) return NO_REPLY;
  const chunks = input.cited_chunks.map(
    ({ doc_id, section, text }) => `[${doc_id} · ${section}]\n${text}`,
  );
  const outputs = input.tool_outputs.map(
    ({ tool, output }) =>
      `${tool}:\n${JSON.stringify(output, null, JSON_INDENT)}`,
  );
  return [
    DRAFT_HEADING,
    input.draft_reply,
    'CITED POLICY CHUNKS',
    chunks.length === 0 ? NOTHING : chunks.join(BLOCK_BREAK),
    'TOOL OUTPUTS (masked)',
    outputs.length === 0 ? NOTHING : outputs.join(BLOCK_BREAK),
  ].join(BLOCK_BREAK);
}
