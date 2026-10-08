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

interface FieldError {
  field: string;
  message: string;
}

interface ExposedHttpError extends Error {
  status: number;
  expose: true;
}

interface ErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  code?: string;
  errors?: FieldError[];
  details?: Record<string, unknown>;
  timestamp: string;
  path: string;
}

const FIRST_CLIENT_ERROR: number = HttpStatus.BAD_REQUEST;
const FIRST_SERVER_ERROR: number = HttpStatus.INTERNAL_SERVER_ERROR;

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';
    let code: string | undefined;
    let errors: FieldError[] | undefined;
    let details: Record<string, unknown> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const responseObj = exceptionResponse as Record<string, unknown>;
        message = (responseObj['message'] as string | string[]) || message;
        error =
          (responseObj['error'] as string) || this.getDefaultErrorName(status);
        code = responseObj['code'] as string | undefined;
        const rawDetails = responseObj['details'];
        if (
          typeof rawDetails === 'object' &&
          rawDetails !== null &&
          !Array.isArray(rawDetails)
        ) {
          details = rawDetails as Record<string, unknown>;
        }

        if (Array.isArray(responseObj['errors'])) {
          errors = responseObj['errors'] as FieldError[];
        }
      } else {
        message = exceptionResponse;
        error = this.getDefaultErrorName(status);
      }
    } else if (isExposedClientError(exception)) {
      status = exception.status;
      message = exception.message;
      error = this.getDefaultErrorName(status);
    } else if (exception instanceof Error) {
      message = reasonOf(exception);
      error = exception.name;
    }

    if (status >= FIRST_SERVER_ERROR) {
      const detail = Array.isArray(message) ? message.join(', ') : message;
      this.logger.error(
        `${request.method} ${request.url} - ${status}: ${detail}`,
        exception instanceof Error ? stackOf(exception) : undefined,
      );
      message = 'Internal server error';
      error = 'Internal Server Error';
      code = undefined;
      errors = undefined;
      details = undefined;
    }

    const errorResponse: ErrorResponse = {
      statusCode: status,
      message,
      error,
      ...(code && { code }),
      ...(errors && { errors }),
      ...(details && { details }),
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(status).json(errorResponse);
  }

  private getDefaultErrorName(status: number): string {
    return STATUS_CODES[status] ?? 'Internal Server Error';
  }
}

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
