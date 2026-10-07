import type { McpToolName } from '@fintech-agent/contracts';
import { dynamicTool, jsonSchema, type ToolSet } from 'ai';

import { toolCallResponse, type GenerateResult } from './mock-model.js';
import {
  CARD_TX,
  cardAuth,
  cardRow,
  customerSeen,
  listed,
} from './validator-fixtures.js';

/** An MCP `CallToolResult` carrying a tool's JSON output. */
export const mcpOk = (value: unknown) => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
});

/** An MCP `CallToolResult` carrying one of the closed tool errors. */
export const mcpFailed = (error: string) => ({
  content: [{ type: 'text', text: JSON.stringify({ error }) }],
  isError: true,
});

export type McpAnswer = (input: unknown) => unknown;

const mcpTool = (answer: McpAnswer) =>
  dynamicTool({
    description: 'fake MCP tool',
    inputSchema: jsonSchema({ type: 'object' }),
    execute: (input) => Promise.resolve(answer(input)),
  });

const CARD_CASE: Record<McpToolName, McpAnswer> = {
  get_customer: () => mcpOk(customerSeen.output),
  list_transactions: () => mcpOk(listed(cardRow()).output),
  get_spei_status: () => mcpFailed('WRONG_TYPE'),
  get_card_authorization: () => mcpOk(cardAuth()),
};

/** The MCP tools as `@ai-sdk/mcp` hands them over, with some answers swapped. */
export function mcpToolsOf(
  answers: Partial<Record<McpToolName, McpAnswer>> = {},
): ToolSet {
  return Object.fromEntries(
    Object.entries({ ...CARD_CASE, ...answers }).map(([name, answer]) => [
      name,
      mcpTool(answer),
    ]),
  );
}

/** The model's tool calls of a card-charge investigation, in order. */
export const investigation: (() => GenerateResult)[] = [
  () => toolCallResponse('get_customer', {}),
  () => toolCallResponse('get_card_authorization', { transaction_id: CARD_TX }),
  () =>
    toolCallResponse('search_policies', { query: 'cargo no reconocido', k: 4 }),
];
