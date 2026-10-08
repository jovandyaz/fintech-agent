import { setTimeout as wait } from 'node:timers/promises';

import {
  Inject,
  Injectable,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationBootstrap,
  type BeforeApplicationShutdown,
} from '@nestjs/common';

import { reasonOf } from '../common/errors/reason-of.js';
import { DATABASE, type Database } from '../database/index.js';
import { POLICIES_DIR } from '../retrieval/ingest.js';
import { loadCatalog, runCaseDepsOf, type AgentConfig } from './core/deps.js';
import { claimNextCase } from './core/queue.js';
import { runCase } from './core/run-case.js';
import { createBreaker, runWorker } from './core/worker.js';

/** The provider holding the agent's variables, and only those (02 G4). */
export const AGENT_CONFIG = 'AGENT_CONFIG';

@Injectable()
class AgentWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger('AgentWorker');
  private readonly stop = new AbortController();
  private running: Promise<void> | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AGENT_CONFIG) private readonly config: AgentConfig,
  ) {}

  onApplicationBootstrap(): void {
    const { db, config, logger } = this;
    const { signal } = this.stop;
    // Read before the first claim: a refused corpus keeps api from booting.
    const deps = runCaseDepsOf({
      config,
      db,
      catalog: loadCatalog(POLICIES_DIR),
      log: (event) => logger.log(event),
    });
    this.running = runWorker({
      claim: () =>
        claimNextCase(db, {
          now: new Date(),
          runTimeoutMs: config.RUN_TIMEOUT_MS,
        }),
      run: (claim) => runCase(deps, claim),
      breaker: createBreaker(() => Date.now()),
      sleep: () =>
        wait(config.AGENT_POLL_MS, undefined, { signal }).catch(
          () => undefined,
        ),
      signal,
      onError: (error) =>
        logger.error({ event: 'agent_cycle_failed', reason: reasonOf(error) }),
    });
    logger.log({ event: 'agent_worker_started' });
  }

  // Before HTTP closes and while the database is open, so no case is claimed
  // during the rest of shutdown.
  async beforeApplicationShutdown(): Promise<void> {
    this.stop.abort();
    await this.running;
    this.logger.log({ event: 'agent_worker_stopped' });
  }
}

/**
 * Runs the queue worker inside `api` (01 §Components): claims due cases one
 * at a time through `runCase` and stops claiming on shutdown, letting the
 * attempt in flight finish within the container's stop grace period.
 */
@Module({})
export class AgentWorkerModule {
  static register(config: AgentConfig): DynamicModule {
    return {
      module: AgentWorkerModule,
      providers: [{ provide: AGENT_CONFIG, useValue: config }, AgentWorker],
    };
  }
}
