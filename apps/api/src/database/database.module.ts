import {
  Inject,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
} from '@nestjs/common';
import postgres, { type Sql } from 'postgres';

/** The postgres.js client for this process's role; repositories build on it. */
export const DATABASE_CLIENT = 'DATABASE_CLIENT';

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
      ],
      exports: [DATABASE_CLIENT],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.end();
  }
}
