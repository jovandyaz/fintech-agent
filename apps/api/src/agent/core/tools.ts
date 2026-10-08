import { isDeepStrictEqual } from 'node:util';

import {
  MCP_TOOL_DESCRIPTIONS,
  MCP_TOOL_NAMES,
  SEARCH_POLICIES_MAX_K,
  SearchPoliciesInputSchema,
  mcpInputJsonSchema,
  toolInputJsonSchema,
  type PolicyChunk,
  type SearchPoliciesInput,
  type SearchPoliciesOutput,
} from '@fintech-agent/contracts';
import {
  createMCPClient,
  type ListToolsResult,
  type MCPClient,
  type MCPClientConfig,
} from '@ai-sdk/mcp';
import { tool, type Tool, type ToolSet } from 'ai';

import type { ToolDefinition } from './prompt.js';
import { POLICY_SEARCH_TOOL } from './validate/evidence.js';

/** A policy as the `search_policies` description lists it (from the manifest). */
export interface PolicyCatalogEntry {
  doc_id: string;
  title: string;
}

/** The policy corpus the agent searches; quarantined chunks never come back (02 G8). */
export interface Retrieval {
  catalog: readonly PolicyCatalogEntry[];
  search(input: SearchPoliciesInput): Promise<PolicyChunk[]>;
}

function searchPoliciesDescription(
  catalog: readonly PolicyCatalogEntry[],
): string {
  const policies = catalog
    .map(({ doc_id, title }) => `${doc_id}: ${title}`)
    .join('; ');
  return `Searches the bank's policies and returns up to ${SEARCH_POLICIES_MAX_K} chunks, each with chunk_id, doc_id, section and content. Query in the policies' own words; doc_id narrows the search to one policy. Policies: ${policies}.`;
}

/**
 * What the model and the trace see when policy search fails: a raw database
 * error could carry query text or connection details (02 G6), so the cause
 * stays on the error object and never becomes the tool result.
 */
export const RETRIEVAL_UNAVAILABLE = 'policy search unavailable';

/** The local `search_policies` tool over the injected retrieval (01 §Tools). */
export function searchPoliciesTool(
  retrieval: Retrieval,
): Tool<SearchPoliciesInput, SearchPoliciesOutput> {
  return tool({
    description: searchPoliciesDescription(retrieval.catalog),
    inputSchema: SearchPoliciesInputSchema,
    execute: async (input) => {
      let chunks: PolicyChunk[];
      try {
        chunks = await retrieval.search(input);
      } catch (error) {
        throw new Error(RETRIEVAL_UNAVAILABLE, { cause: error });
      }
      return { chunks: chunks.slice(0, input.k) };
    },
  });
}

/**
 * Every tool the model is offered, in order, as `prompt_version` hashes it.
 * The MCP tools come from the contract, so the version is known before the
 * run can reach the server.
 */
export function toolDefinitions(
  catalog: readonly PolicyCatalogEntry[],
): ToolDefinition[] {
  return [
    ...MCP_TOOL_NAMES.map((name) => ({
      name,
      description: MCP_TOOL_DESCRIPTIONS[name],
      inputSchema: mcpInputJsonSchema(name),
    })),
    {
      name: POLICY_SEARCH_TOOL,
      description: searchPoliciesDescription(catalog),
      inputSchema: toolInputJsonSchema(SearchPoliciesInputSchema),
    },
  ];
}

/** The MCP server lists tools other than the contract's, so the run cannot trust its `prompt_version`. */
export class ToolSetMismatchError extends Error {
  constructor() {
    super('MCP tools/list differs from the contract tools');
  }
}

export type McpConnection = Pick<
  MCPClient,
  'listTools' | 'toolsFromDefinitions' | 'close'
>;

/** An open MCP session bound to one case token; close it when the run ends. */
export interface CaseTools {
  tools: ToolSet;
  close(): Promise<void>;
}

const matchesContract = ({ tools }: ListToolsResult): boolean =>
  tools.length === MCP_TOOL_NAMES.length &&
  tools.every(
    ({ name, description, inputSchema }, index) =>
      name === MCP_TOOL_NAMES[index] &&
      description === MCP_TOOL_DESCRIPTIONS[name] &&
      isDeepStrictEqual(inputSchema, mcpInputJsonSchema(name)),
  );

/**
 * Opens the MCP tools of one run, the case token as the bearer: the server
 * resolves the customer from it, so no tool takes a customer id (02 G4).
 * The server validates arguments itself. `signal` bounds the connection
 * and the listing by the attempt. A server listing other tools than the
 * contract is closed and refused with `ToolSetMismatchError`.
 */
export async function connectCaseTools(
  target: { url: string; token: string; signal: AbortSignal },
  connect: (
    config: MCPClientConfig,
  ) => Promise<McpConnection> = createMCPClient,
): Promise<CaseTools> {
  const client = await connect({
    transport: {
      type: 'http',
      url: target.url,
      headers: { Authorization: `Bearer ${target.token}` },
    },
    initializationOptions: { signal: target.signal },
  });
  try {
    const definitions = await client.listTools({
      options: { signal: target.signal },
    });
    if (!matchesContract(definitions)) throw new ToolSetMismatchError();
    return {
      tools: client.toolsFromDefinitions(definitions),
      close: () => client.close(),
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}
