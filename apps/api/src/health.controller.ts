import {
  Controller,
  Get,
  Inject,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Sql } from 'postgres';

import { reasonOf } from './common/errors/reason-of.js';
import { DATABASE_CLIENT } from './database/index.js';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(DATABASE_CLIENT) private readonly sql: Sql) {}

  // postgres.js connects lazily, so only a query proves the role can log in.
  @Get()
  async check(): Promise<{ status: 'ok' }> {
    try {
      await this.sql`select 1`;
    } catch (error) {
      this.logger.warn({
        event: 'health_db_unavailable',
        reason: reasonOf(error),
      });
      throw new ServiceUnavailableException({ status: 'unavailable' });
    }
    return { status: 'ok' };
  }
}
