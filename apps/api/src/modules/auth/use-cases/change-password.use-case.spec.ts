import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { ErrorCode } from '../../../common/errors/error-codes';

const auditCreate = vi.fn();
vi.mock('@ipeasy/db', () => ({
  prisma: {
    audit_logs: { create: (...args: unknown[]) => auditCreate(...args) },
  },
  Prisma: {},
}));

const bcrypt = vi.hoisted(() => ({
  compare: vi.fn(),
  hash: vi.fn(),
}));
vi.mock('bcryptjs', () => bcrypt);

import { ChangePasswordUseCase } from './change-password.use-case';
import { AuthRepository } from '../auth.repository';

function userContext(overrides: Partial<AuthenticatedContext> = {}): AuthenticatedContext {
  return {
    ownerId: 'user-1',
    ownerType: 'USER',
    siteId: 'site-1',
    tenantId: 'tenant-1',
    scopes: [],
    requestId: 'req-1',
    ...overrides,
  };
}

function repoMock(overrides: Partial<AuthRepository> = {}): AuthRepository {
  return {
    findUserPasswordHash: vi.fn().mockResolvedValue('old-hash'),
    updateUserPassword: vi.fn().mockResolvedValue(undefined),
    revokeOtherUserSessions: vi.fn().mockResolvedValue(2),
    ...overrides,
  } as unknown as AuthRepository;
}

beforeEach(() => {
  auditCreate.mockReset();
  bcrypt.compare.mockReset();
  bcrypt.hash.mockReset();
});

describe('ChangePasswordUseCase', () => {
  it('rejects non-USER callers before touching credentials', async () => {
    const repo = repoMock();
    const useCase = new ChangePasswordUseCase(repo);

    await expect(
      useCase.execute(userContext({ ownerType: 'PLATFORM_ADMIN', tenantId: null }), 'sess-1', {
        oldPassword: 'oldsecret1',
        newPassword: 'newsecret1',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
    expect(repo.findUserPasswordHash).not.toHaveBeenCalled();
  });

  it('rejects a new password below the minimum length without revealing the old one', async () => {
    const repo = repoMock();
    const useCase = new ChangePasswordUseCase(repo);

    await expect(
      useCase.execute(userContext(), 'sess-1', { oldPassword: 'oldsecret1', newPassword: 'short' }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, reasonKey: 'password_too_weak' });
    expect(repo.findUserPasswordHash).not.toHaveBeenCalled();
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it('rejects a wrong old password with a uniform error and no write', async () => {
    bcrypt.compare.mockResolvedValueOnce(false);
    const repo = repoMock();
    const useCase = new ChangePasswordUseCase(repo);

    await expect(
      useCase.execute(userContext(), 'sess-1', { oldPassword: 'wrongpass1', newPassword: 'newsecret1' }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, reasonKey: 'old_password_incorrect' });
    expect(repo.updateUserPassword).not.toHaveBeenCalled();
    expect(repo.revokeOtherUserSessions).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('rejects reusing the same password', async () => {
    // first compare = old password matches; second compare = new equals current
    bcrypt.compare.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    const repo = repoMock();
    const useCase = new ChangePasswordUseCase(repo);

    await expect(
      useCase.execute(userContext(), 'sess-1', { oldPassword: 'oldsecret1', newPassword: 'oldsecret1again' }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, reasonKey: 'password_reuse' });
    expect(repo.updateUserPassword).not.toHaveBeenCalled();
  });

  it('re-hashes with a production cost, revokes other sessions, and audits on success', async () => {
    bcrypt.compare.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    bcrypt.hash.mockResolvedValueOnce('new-hash');
    const repo = repoMock();
    const useCase = new ChangePasswordUseCase(repo);

    await useCase.execute(userContext(), 'sess-1', {
      oldPassword: 'oldsecret1',
      newPassword: 'newsecret1',
    });

    expect(bcrypt.hash).toHaveBeenCalledWith('newsecret1', 10);
    expect(repo.updateUserPassword).toHaveBeenCalledWith('user-1', 'site-1', 'new-hash');
    expect(repo.revokeOtherUserSessions).toHaveBeenCalledWith('user-1', 'sess-1');
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0]![0].data).toMatchObject({
      actorType: 'USER',
      actorId: 'user-1',
      action: 'auth.change_password',
    });
  });
});
