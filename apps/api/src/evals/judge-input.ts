import { z } from 'zod';

/** One policy chunk a draft cites, with the text the model read. */
export const CitedChunkSchema = z.object({
  doc_id: z.string(),
  section: z.string(),
  text: z.string(),
});
export type CitedChunk = z.infer<typeof CitedChunkSchema>;

/** One tool call's output as `run_steps` stored it, masked. */
export const ToolOutputSchema = z.object({
  tool: z.string(),
  output: z.unknown(),
});
export type ToolOutput = z.infer<typeof ToolOutputSchema>;

/**
 * What the groundedness judge reads, never the label (03 §Judge
 * validation): the model's accepted draft with its `{{…}}` placeholders
 * unfilled, its cited chunks and the masked tool outputs. The provider
 * records it, the calibration rows carry it.
 */
export const JudgeInputSchema = z.object({
  draft_reply: z.string(),
  cited_chunks: z.array(CitedChunkSchema),
  tool_outputs: z.array(ToolOutputSchema),
});
export type JudgeInput = z.infer<typeof JudgeInputSchema>;
