import { describe, it, expect } from 'vitest';
import { Prisma } from '@ipeasy/db/generated/client';
import { isUniqueConstraintError } from './prisma-errors';

describe('Prisma error helpers', () => {
  it('detects P2002 unique constraint errors by target field', () => {
    const error = new Prisma.PrismaClientKnownRequestError('unique violation', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['idempotencyKey'] },
    });

    expect(isUniqueConstraintError(error)).toBe(true);
    expect(isUniqueConstraintError(error, 'idempotencyKey')).toBe(true);
    expect(isUniqueConstraintError(error, 'email')).toBe(false);
  });
});
