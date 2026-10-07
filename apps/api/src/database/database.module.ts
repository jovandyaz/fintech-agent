import {
  Inject,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import * as schema from './schema.js';

/** The postgres.js client for this process's role; repositories build on it. */
export const DATABASE_CLIENT = 'DATABASE_CLIENT';
/** Drizzle over that client, with the schema of 01. */
export const DATABASE = 'DATABASE';
export type Database = PostgresJsDatabase<typeof schema>;

const POOL_SIZE = 10;
const IDLE_TIMEOUT_S = 20;
const CONNECT_TIMEOUT_S = 10;

/** Provides the postgres.js client for one role's connection URL (02 G1). */
@Module({})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_CLIENT) private readonly client: Sql) {}

  static forRoot(url: string): DynamicModule {
    return {
      module: DatabaseModule,
      global: true,
      providers: [
        {
          provide: DATABASE_CLIENT,
          useFactory: (): Sql =>
            postgres(url, {
              max: POOL_SIZE,
              idle_timeout: IDLE_TIMEOUT_S,
              connect_timeout: CONNECT_TIMEOUT_S,
              onnotice: () => undefined,
            }),
        },
        {
          provide: DATABASE,
          inject: [DATABASE_CLIENT],
          useFactory: (client: Sql): Database => drizzle({ client, schema }),
        },
      ],
      exports: [DATABASE_CLIENT, DATABASE],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.end();
  }
}
