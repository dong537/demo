import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { ErrorCode } from '../../../common/errors/error-codes';

const prismaMock = vi.hoisted(() => {
  const usersFindFirst = vi.fn();
  const sessionsCreate = vi.fn();
  const auditCreate = vi.fn();
  const transaction = vi.fn(async (fn: (tx: unknown) => unknown) =>
    fn({
      sessions: { create: sessionsCreate },
      audit_logs: { create: auditCreate },
    }),
  );
  return { usersFindFirst, sessionsCreate, auditCreate, transaction };
});

vi.mock('@ipeasy/db', () => ({
  prisma: {
    users: { findFirst: prismaMock.usersFindFirst },
    $transaction: prismaMock.transaction,
  },
}));

const cryptoMock = vi.hoisted(() => {
  const digest = vi.fn(() => 'hashed-token');
  const update = vi.fn(() => ({ digest }));
  return {
    randomBytes: vi.fn(() => Buffer.from('synthetic-impersonation-token-seed')),
    createHash: vi.fn(() => ({ update })),
    update,
    digest,
  };
});

vi.mock('crypto', () => ({
  randomBytes: cryptoMock.randomBytes,
  createHash: cryptoMock.createHash,
}));

import { ImpersonateUserUseCase } from './impersonate-user.use-case';

function ctx(overrides: Partial<AuthenticatedContext> = {}): AuthenticatedContext {
  return {
    ownerId: 'admin-1',
    ownerType: 'PLATFORM_ADMIN',
    siteId: 'site-1',
    tenantId: null,
    scopes: [],
    requestId: 'req-1',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.usersFindFirst.mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1' });
  prismaMock.sessionsCreate.mockResolvedValue({ expiresAt: new Date('2026-06-13T08:00:00.000Z') });
});

describe('ImpersonateUserUseCase', () => {
  it('creates a USER session and audit row for a platform admin', async () => {
    const useCase = new ImpersonateUserUseCase();

    const result = await useCase.execute(ctx(), 'user-1');
    const expectedToken = Buffer.from('synthetic-impersonation-token-seed').toString('hex');

    expect(prismaMock.usersFindFirst).toHaveBeenCalledWith({
      where: { id: 'user-1', siteId: 'site-1', status: 'ACTIVE' },
      select: { id: true, tenantId: true },
    });
    expect(cryptoMock.createHash).toHaveBeenCalledWith('sha256');
    expect(cryptoMock.update).toHaveBeenCalledWith(expectedToken);
    expect(prismaMock.sessionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        ownerType: 'USER',
        ownerId: 'user-1',
        siteId: 'site-1',
        tenantId: 'tenant-1',
        token: 'hashed-token',
      }),
    }));
    expect(prismaMock.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        siteId: 'site-1',
        tenantId: 'tenant-1',
        actorType: 'ADMIN_USER',
        actorId: 'admin-1',
        targetType: 'user',
        targetId: 'user-1',
        action: 'users.impersonate',
        requestId: 'req-1',
      }),
    });
    expect(result).toEqual({
      token: expectedToken,
      expiresAt: new Date('2026-06-13T08:00:00.000Z'),
    });
  });

  it('scopes tenant admins to their own tenant', async () => {
    const useCase = new ImpersonateUserUseCase();

    await useCase.execute(ctx({ ownerType: 'TENANT_ADMIN', tenantId: 'tenant-1' }), 'user-1');

    expect(prismaMock.usersFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-1', siteId: 'site-1', tenantId: 'tenant-1', status: 'ACTIVE' },
    }));
  });

  it('rejects non-admin callers before reading the user', async () => {
    const useCase = new ImpersonateUserUseCase();

    await expect(useCase.execute(ctx({ ownerType: 'USER', tenantId: 'tenant-1' }), 'user-1')).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
      reasonKey: 'insufficient_permissions',
    });
    expect(prismaMock.usersFindFirst).not.toHaveBeenCalled();
  });

  it('returns not found for missing or inactive users', async () => {
    prismaMock.usersFindFirst.mockResolvedValue(null);
    const useCase = new ImpersonateUserUseCase();

    await expect(useCase.execute(ctx(), 'missing-user')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      reasonKey: 'user_not_found',
    });
    expect(prismaMock.transaction).not.toHaveBeenCalled();
  });
});
