import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Validates a request body with a contracts schema (rule: Zod at the edge).
 * The 400 names each failing path and issue code, never the input values.
 */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'invalid_body',
        issues: parsed.error.issues.map(({ path, code }) => ({
          path: path.join('.'),
          code,
        })),
      });
    }
    return parsed.data;
  }
}
