import { StateRuleSchema } from '@fintech-agent/contracts';
import { z } from 'zod';

import type { Database } from '../../database/index.js';
import { policyChunks } from '../../database/schema.js';
import type { ChunkStateRules } from './validate/state-rules.js';

const StateRulesSchema = z.array(StateRuleSchema);

/**
 * Every chunk's state rules, quarantined ones included so the validator can
 * skip them by name (02 G5: every non-quarantined rule runs, cited or not).
 * A rule that does not parse throws: ingestion wrote it, so it is a bug.
 */
export async function corpusStateRules(
  db: Database,
): Promise<ChunkStateRules[]> {
  const rows = await db
    .select({
      chunkId: policyChunks.id,
      quarantined: policyChunks.quarantined,
      stateRules: policyChunks.stateRules,
    })
    .from(policyChunks);
  return rows.map(({ chunkId, quarantined, stateRules }) => ({
    chunk_id: chunkId,
    quarantined,
    rules: StateRulesSchema.parse(stateRules),
  }));
}
