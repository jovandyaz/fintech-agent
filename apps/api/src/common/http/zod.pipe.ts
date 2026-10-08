import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** What a 400 says failed: the body, a path parameter or the query string. */
export const INPUT_PART = {
  body: 'invalid_body',
  path: 'invalid_path',
  query: 'invalid_query',
} as const;

/**
 * Validates a request body, path parameter or query string with a contracts
 * schema (rule: Zod at the edge). The 400 names each failing path and issue
 * code, never the input values.
 */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(
    private readonly schema: z.ZodType<T>,
    private readonly failure: (typeof INPUT_PART)[keyof typeof INPUT_PART] = INPUT_PART.body,
  ) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({
        message: this.failure,
        issues: parsed.error.issues.map(({ path, code }) => ({
          path: path.join('.'),
          code,
        })),
      });
    }
    return parsed.data;
  }
}
