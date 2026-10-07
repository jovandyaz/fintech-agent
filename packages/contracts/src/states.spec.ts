import { describe, expect, it } from 'vitest';

import {
  ACTION_STATUSES,
  CASE_SOURCES,
  CASE_STATUSES,
  DB_ROLES,
  EXECUTION_STATUSES,
  REVIEW_TIERS,
  RUN_STATUSES,
  SECURITY_EVENT_KINDS,
  STEP_KINDS,
  STOP_REASONS,
} from './states.js';

describe('persisted state sets (01 Data model, 02 G1)', () => {
  it('keep the members and order the database enums are migrated from', () => {
    expect(CASE_STATUSES).toEqual([
      'queued',
      'investigating',
      'needs_review',
      'resolved',
      'failed',
    ]);
    expect(CASE_SOURCES).toEqual(['webhook', 'console', 'eval']);
    expect(REVIEW_TIERS).toEqual(['standard', 'high']);
    expect(RUN_STATUSES).toEqual([
      'running',
      'succeeded',
      'fallback',
      'failed',
      'abandoned',
    ]);
    expect(STOP_REASONS).toEqual([
      'completed',
      'budget',
      'validation',
      'agent_disabled',
      'error',
    ]);
    expect(STEP_KINDS).toEqual([
      'llm',
      'tool',
      'retrieval',
      'guard',
      'validation',
    ]);
    expect(ACTION_STATUSES).toEqual([
      'proposed',
      'approved',
      'executed',
      'rejected',
      'failed',
      'superseded',
      'canary_caught',
      'canary_missed',
    ]);
    expect(EXECUTION_STATUSES).toEqual(['started', 'executed', 'failed']);
    expect(SECURITY_EVENT_KINDS).toEqual(['cross_customer_lookup']);
    expect(DB_ROLES).toEqual([
      'copilot_api',
      'copilot_executor',
      'copilot_mcp',
    ]);
  });
});
