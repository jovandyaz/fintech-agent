import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { assertApiEnv } from './boot.js';
import { loadApiConfig } from './config.js';
import { JsonConsoleLogger } from './core/logging/json-console-logger.js';

assertApiEnv(process.env);
const config = loadApiConfig(process.env);
const app = await NestFactory.create(AppModule.register(config), {
  logger: new JsonConsoleLogger(),
});
app.enableShutdownHooks();
await app.listen(config.API_PORT);
