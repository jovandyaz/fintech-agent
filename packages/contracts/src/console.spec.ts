import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  CaseDetailSchema,
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

// Every key a console DTO may carry, at any depth. A new field lands here on
// purpose, where a reviewer weighs whether it tells a canary apart (02 G3).
const ALLOWED_KEYS: Record<keyof typeof CONSOLE_DTOS, string[]> = {
  OperatorViewSchema: ['id'],
  StatusSchema: ['agent'],
  CustomerOptionSchema: ['first_name', 'id'],
  InboxItemSchema: [
    'case_id',
    'category',
    'flags',
    'folio',
    'received_at',
    'review_tier',
    'status',
  ],
  CaseDetailSchema: [
    'abstained',
    'action_id',
    'actions',
    'amount',
    'auth_factors',
    'case',
    'case_id',
    'category',
    'channel',
    'chunk_id',
    'citations',
    'cost_usd',
    'counterparty_clabe',
    'counterparty_first_name',
    'created_at',
    'doc_id',
    'draft_reply',
    'error_code',
    'flags',
    'folio',
    'id',
    'idx',
    'input',
    'input_tokens',
    'justification',
    'kind',
    'latency_ms',
    'manual_reruns',
    'max',
    'merchant_descriptor',
    'min',
    'model',
    'name',
    'output',
    'output_tokens',
    'override_options',
    'params',
    'proposal',
    'quote',
    'reason_code',
    'reasoning_summary',
    'received_at',
    'resolution',
    'review_tier',
    'run_id',
    'runs',
    'section',
    'status',
    'steps',
    'stop_reason',
    'text',
    'transaction_ids',
    'transactions',
    'type',
  ],
};

describe('console DTOs (02 G3, G6)', () => {
  it.each(Object.entries(CONSOLE_DTOS))(
    '%s carries exactly the reviewed keys',
    (name, schema) => {
      const names = new Set(
        propertyNamesOf(z.toJSONSchema(schema, { io: 'output' })),
      );
      expect([...names].sort()).toEqual(
        ALLOWED_KEYS[name as keyof typeof CONSOLE_DTOS],
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
