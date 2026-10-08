import type { JudgeInput } from '@fintech-agent/api/evals';

const JSON_INDENT = 2;
const BLOCK_BREAK = '\n\n';
const NOTHING = '(none)';

/**
 * What the groundedness judge reads for one draft (03 §Judge validation):
 * the draft, the cited policy chunks and the masked tool outputs, never the
 * label or the case's expected action.
 */
export function judgeText(input: JudgeInput): string {
  const chunks = input.cited_chunks.map(
    ({ doc_id, section, text }) => `[${doc_id} · ${section}]\n${text}`,
  );
  const outputs = input.tool_outputs.map(
    ({ tool, output }) =>
      `${tool}:\n${JSON.stringify(output, null, JSON_INDENT)}`,
  );
  return [
    'DRAFT REPLY',
    input.draft_reply,
    'CITED POLICY CHUNKS',
    chunks.length === 0 ? NOTHING : chunks.join(BLOCK_BREAK),
    'TOOL OUTPUTS (masked)',
    outputs.length === 0 ? NOTHING : outputs.join(BLOCK_BREAK),
  ].join(BLOCK_BREAK);
}
