import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  CaseAcknowledgmentSchema,
  CaseDetailSchema,
  DecisionAnswerSchema,
  RerunAnswerSchema,
  InboxItemSchema,
  OperatorViewSchema,
  StatusSchema,
} from './console.js';
import { CustomerOptionSchema } from './core.js';

const CONSOLE_DTOS = {
  OperatorViewSchema,
  StatusSchema,
  CustomerOptionSchema,
  InboxItemSchema,
  CaseDetailSchema,
  CaseAcknowledgmentSchema,
  DecisionAnswerSchema,
  RerunAnswerSchema,
};

// 02 G3: a canary is told apart only after the decision; these fields would
// tell it before (the flag itself, the ids a real sender chose, and the audit
// and run times a canary's injection shapes).
const TELLTALE_KEYS = [
  'is_canary',
  'canary',
  'ticket_id',
  'event_id',
  'at',
  'proposed_at',
  'decided_at',
  'started_at',
  'finished_at',
];

function propertyNamesOf(schema: unknown): string[] {
  if (Array.isArray(schema)) return schema.flatMap(propertyNamesOf);
  if (typeof schema !== 'object' || schema === null) return [];
  const own =
    'properties' in schema &&
    typeof schema.properties === 'object' &&
    schema.properties !== null
      ? Object.keys(schema.properties)
      : [];
  return [...own, ...Object.values(schema).flatMap(propertyNamesOf)];
}

function objectNodesOf(schema: unknown): Record<string, unknown>[] {
  if (Array.isArray(schema)) return schema.flatMap(objectNodesOf);
  if (typeof schema !== 'object' || schema === null) return [];
  const node = schema as Record<string, unknown>;
  return [
    ...('properties' in node ? [node] : []),
    ...Object.values(node).flatMap(objectNodesOf),
  ];
}

// Every path a console DTO may carry. A new field lands here on purpose, where
// a reviewer weighs whether it tells a canary apart (02 G3); a path, not a bare
// name, so a nested field reusing an existing name is still a new entry.
const ALLOWED_PATHS: Record<keyof typeof CONSOLE_DTOS, string[]> = {
  OperatorViewSchema: ['.id'],
  StatusSchema: ['.agent'],
  CustomerOptionSchema: ['.first_name', '.id'],
  InboxItemSchema: [
    '.case_id',
    '.category',
    '.flags',
    '.folio',
    '.received_at',
    '.review_tier',
    '.status',
  ],
  CaseAcknowledgmentSchema: ['.case_id', '.folio'],
  DecisionAnswerSchema: ['.action_id', '.status'],
  RerunAnswerSchema: ['.case_id', '.manual_reruns', '.status'],
  CaseDetailSchema: [
    '.case',
    '.case.case_id',
    '.case.category',
    '.case.flags',
    '.case.folio',
    '.case.manual_reruns',
    '.case.received_at',
    '.case.review_tier',
    '.case.status',
    '.case.text',
    '.override_options',
    '.override_options.actions',
    '.override_options.actions[].max',
    '.override_options.actions[].min',
    '.override_options.actions[].transaction_ids',
    '.override_options.actions[].type',
    '.override_options.transactions',
    '.override_options.transactions[].amount',
    '.override_options.transactions[].auth_factors',
    '.override_options.transactions[].channel',
    '.override_options.transactions[].counterparty_clabe',
    '.override_options.transactions[].counterparty_first_name',
    '.override_options.transactions[].created_at',
    '.override_options.transactions[].id',
    '.override_options.transactions[].merchant_descriptor',
    '.override_options.transactions[].status',
    '.override_options.transactions[].type',
    '.proposal',
    '.proposal.action_id',
    '.proposal.justification',
    '.proposal.params',
    '.proposal.params.reason_code',
    '.proposal.params.transaction_ids',
    '.proposal.status',
    '.proposal.type',
    '.resolution',
    '.resolution.abstained',
    '.resolution.category',
    '.resolution.citations',
    '.resolution.citations[].chunk_id',
    '.resolution.citations[].doc_id',
    '.resolution.citations[].quote',
    '.resolution.citations[].section',
    '.resolution.draft_reply',
    '.resolution.reasoning_summary',
    '.runs',
    '.runs[].cost_usd',
    '.runs[].error_code',
    '.runs[].input_tokens',
    '.runs[].latency_ms',
    '.runs[].model',
    '.runs[].output_tokens',
    '.runs[].run_id',
    '.runs[].status',
    '.runs[].steps',
    '.runs[].steps[].cost_usd',
    '.runs[].steps[].idx',
    '.runs[].steps[].input',
    '.runs[].steps[].kind',
    '.runs[].steps[].latency_ms',
    '.runs[].steps[].name',
    '.runs[].steps[].output',
    '.runs[].stop_reason',
  ],
};

function pathsOf(schema: unknown, prefix = ''): string[] {
  if (typeof schema !== 'object' || schema === null) return [];
  const node = schema as Record<string, unknown>;
  const properties =
    typeof node.properties === 'object' && node.properties !== null
      ? Object.entries(node.properties).flatMap(([key, child]) => [
          `${prefix}.${key}`,
          ...pathsOf(child, `${prefix}.${key}`),
        ])
      : [];
  const variants = ['anyOf', 'oneOf', 'allOf'].flatMap((key) => {
    const options = node[key];
    return Array.isArray(options)
      ? options.flatMap((option) => pathsOf(option, prefix))
      : [];
  });
  return [...properties, ...pathsOf(node.items, `${prefix}[]`), ...variants];
}

describe('console DTOs (02 G3, G6)', () => {
  it.each(Object.entries(CONSOLE_DTOS))(
    '%s carries exactly the reviewed paths',
    (name, schema) => {
      const paths = new Set(pathsOf(z.toJSONSchema(schema, { io: 'output' })));
      expect([...paths].sort()).toEqual(
        ALLOWED_PATHS[name as keyof typeof CONSOLE_DTOS],
      );
    },
  );

  it.each(Object.entries(CONSOLE_DTOS))(
    '%s carries no field that tells a canary apart',
    (_, schema) => {
      const names = propertyNamesOf(z.toJSONSchema(schema, { io: 'output' }));
      expect(names.length).toBeGreaterThan(0);
      expect(names.filter((name) => TELLTALE_KEYS.includes(name))).toEqual([]);
    },
  );

  it.each(Object.entries(CONSOLE_DTOS))(
    '%s refuses unknown keys at every level',
    (_, schema) => {
      // Output schemas look closed even when stripping, so strictness shows on input.
      const objects = objectNodesOf(z.toJSONSchema(schema, { io: 'input' }));
      expect(objects.length).toBeGreaterThan(0);
      for (const node of objects) {
        expect(node.additionalProperties).toBe(false);
      }
    },
  );
});
