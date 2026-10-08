import { STATUS_CODES } from 'node:http';

import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { reasonOf } from '../errors/reason-of.js';
import { stackOf } from '../errors/stack-of.js';

interface ExposedHttpError extends Error {
  status: number;
  expose: true;
}

const FIRST_CLIENT_ERROR: number = HttpStatus.BAD_REQUEST;
const FIRST_SERVER_ERROR: number = HttpStatus.INTERNAL_SERVER_ERROR;
const SERVICE_UNAVAILABLE: number = HttpStatus.SERVICE_UNAVAILABLE;
const SERVER_ERROR_MESSAGE = 'Internal server error';

/**
 * Answers every failure (ported from Knowtis, trimmed): a refusal this API
 * built goes out as built, a body the parser refused keeps its 413 or 415, and
 * any other failure keeps only its 5xx status: the detail is logged masked,
 * never sent.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // A 4xx, or the 503 this API sends when core-mock is down, is chosen on
    // purpose; any other 5xx may be a library's, built from its internals.
    if (
      exception instanceof HttpException &&
      isDeliberate(exception.getStatus())
    ) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response
        .status(status)
        .json(
          typeof body === 'string'
            ? { statusCode: status, message: body }
            : body,
        );
      return;
    }

    if (isExposedClientError(exception)) {
      response.status(exception.status).json({
        statusCode: exception.status,
        message: exception.message,
        error: STATUS_CODES[exception.status],
      });
      return;
    }

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : FIRST_SERVER_ERROR;
    this.logger.error(
      `${request.method} ${request.url} - ${status}: ${reasonOf(exception)}`,
      exception instanceof Error ? stackOf(exception) : undefined,
    );
    response.status(status).json({
      statusCode: status,
      message: SERVER_ERROR_MESSAGE,
      error: STATUS_CODES[status],
    });
  }
}

const isDeliberate = (status: number): boolean =>
  status < FIRST_SERVER_ERROR || status === SERVICE_UNAVAILABLE;

// Nest turns only a body parser's SyntaxError into a 400, so its other
// rejections (413, 415) would otherwise be answered as a 500; `expose` is how
// http-errors marks a status and message as safe for the client.
function isExposedClientError(
  exception: unknown,
): exception is ExposedHttpError {
  return (
    exception instanceof Error &&
    'expose' in exception &&
    exception.expose === true &&
    'status' in exception &&
    typeof exception.status === 'number' &&
    exception.status >= FIRST_CLIENT_ERROR &&
    exception.status < FIRST_SERVER_ERROR
  );
}
