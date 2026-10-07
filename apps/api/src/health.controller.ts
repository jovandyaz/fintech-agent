import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Sql } from 'postgres';

import { DATABASE_CLIENT } from './database/index.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE_CLIENT) private readonly sql: Sql) {}

  // postgres.js connects lazily, so only a query proves the role can log in.
  @Get()
  async check(): Promise<{ status: 'ok' }> {
    try {
      await this.sql`select 1`;
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable' });
    }
    return { status: 'ok' };
  }
}
