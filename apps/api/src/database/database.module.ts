import {
  Inject,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import * as schema from './schema.js';

export const DATABASE_URL = 'DATABASE_URL';
export const DATABASE_CONNECTION = 'DATABASE_CONNECTION';
/** Raw postgres-js client. Inject only to pin work to one connection; everything else uses `DATABASE_CONNECTION`. */
export const DATABASE_CLIENT = 'DATABASE_CLIENT';

const POOL_SIZE = 10;
const IDLE_TIMEOUT_S = 20;
const CONNECT_TIMEOUT_S = 10;

export type Database = PostgresJsDatabase<typeof schema>;

/** Provides the Drizzle database for one role's connection URL (02 G1). */
@Module({})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_CLIENT) private readonly client: Sql) {}

  static forRoot(url: string): DynamicModule {
    return {
      module: DatabaseModule,
      global: true,
      providers: [
        { provide: DATABASE_URL, useValue: url },
        {
          provide: DATABASE_CLIENT,
          useFactory: (databaseUrl: string): Sql =>
            postgres(databaseUrl, {
              max: POOL_SIZE,
              idle_timeout: IDLE_TIMEOUT_S,
              connect_timeout: CONNECT_TIMEOUT_S,
              onnotice: () => undefined,
            }),
          inject: [DATABASE_URL],
        },
        {
          provide: DATABASE_CONNECTION,
          useFactory: (client: Sql): Database => drizzle(client, { schema }),
          inject: [DATABASE_CLIENT],
        },
      ],
      exports: [DATABASE_CONNECTION, DATABASE_CLIENT],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.end();
  }
}
