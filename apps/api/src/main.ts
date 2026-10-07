import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { assertApiEnv } from './boot.js';
import { reasonOf } from './common/errors/reason-of.js';
import { JsonConsoleLogger } from './common/logging/json-console-logger.js';
import { loadApiConfig } from './config.js';

const logger = new JsonConsoleLogger();
try {
  assertApiEnv(process.env);
  const config = loadApiConfig(process.env);
  const app = await NestFactory.create(AppModule.register(config), { logger });
  app.enableShutdownHooks();
  await app.listen(config.API_PORT);
} catch (error) {
  logger.fatal({ event: 'boot_failed', reason: reasonOf(error) });
  process.exitCode = 1;
}
