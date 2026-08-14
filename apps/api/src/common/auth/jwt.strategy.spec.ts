import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '../errors/error-codes';

vi.mock('@ipeasy/db', () => ({ prisma: { admin_users: { findUnique: vi.fn() } } }));

import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  it('never accepts a legacy refresh token as a bearer access token', async () => {
    const authRepo = { findSessionByTokenHash: vi.fn() };

    await expect(new JwtStrategy(authRepo as never).authenticate('rt_refresh-token'))
      .rejects.toMatchObject({ code: ErrorCode.AUTH_REQUIRED });
    expect(authRepo.findSessionByTokenHash).not.toHaveBeenCalled();
  });
});
