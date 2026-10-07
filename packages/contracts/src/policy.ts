import { z } from 'zod';

import { TX_STATUSES, TX_TYPES } from './core.js';
import { CardAuthorizationSchema, SpeiStatusSchema } from './mcp.js';

/** One chunk as `search_policies` returns it: the normalized text only (02 G8). */
export const PolicyChunkSchema = z.strictObject({
  chunk_id: z.string().min(1),
  doc_id: z.string().min(1),
  section: z.string().min(1),
  content: z.string(),
});
export type PolicyChunk = z.infer<typeof PolicyChunkSchema>;

export const SearchPoliciesOutputSchema = z.strictObject({
  chunks: z.array(PolicyChunkSchema),
});

/** `>=1`, `<3`, `=0`: a business-day count compared with a non-negative integer. */
export const DAY_COMPARISON = /^(>=|<=|>|<|=)(\d{1,3})$/;

// Ops reads the id next to a forced `none`, so it is a name, never prose.
const RULE_ID = /^[a-z][a-z0-9_]{0,63}$/;

const StatusFieldSchema = z.union([
  SpeiStatusSchema.keyof(),
  CardAuthorizationSchema.keyof(),
]);

/**
 * A rule from a policy's front matter (01 `policy_chunks.state_rules`): when
 * a transaction's status output matches `applies_to`, the named field of
 * that output must not be null, or the run has a `POLICY_DATA_CONFLICT`.
 */
export const StateRuleSchema = z.strictObject({
  id: z.string().regex(RULE_ID),
  applies_to: z
    .strictObject({
      type: z.enum(TX_TYPES).optional(),
      status: z.enum(TX_STATUSES).optional(),
      returned_business_days_ago: z.string().regex(DAY_COMPARISON).optional(),
    })
    .refine((appliesTo) => Object.keys(appliesTo).length > 0, {
      message: 'a rule must narrow the transactions it applies to',
    }),
  requires: z.strictObject({
    field: StatusFieldSchema,
    not_null: z.literal(true),
  }),
});
export type StateRule = z.infer<typeof StateRuleSchema>;
