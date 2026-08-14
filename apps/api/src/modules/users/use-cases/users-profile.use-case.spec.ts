import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { ErrorCode } from '../../../common/errors/error-codes';

const usersDb = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
}));
const auditCreate = vi.fn();
vi.mock('@ipeasy/db', () => ({
  prisma: {
    users: usersDb,
    audit_logs: { create: (...args: unknown[]) => auditCreate(...args) },
  },
  Prisma: {},
}));

import { UsersRepository } from '../users.repository';
import { GetMeUseCase } from './get-me.use-case';
import { UpdateMeUseCase } from './update-me.use-case';

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

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'user@example.com',
    name: 'Old Name',
    phone: '123',
    status: 'ACTIVE',
    kycStatus: 'PENDING',
    riskStatus: 'NORMAL',
    ...overrides,
  };
}

beforeEach(() => {
  usersDb.findFirst.mockReset();
  usersDb.updateMany.mockReset();
  auditCreate.mockReset();
});

describe('GetMeUseCase', () => {
  it('scopes the read to the caller and never selects passwordHash', async () => {
    usersDb.findFirst.mockResolvedValue(profileRow());
    const useCase = new GetMeUseCase(new UsersRepository());

    const result = await useCase.execute(userContext());

    const call = usersDb.findFirst.mock.calls[0]![0];
    expect(call.where).toEqual({ id: 'user-1', siteId: 'site-1', tenantId: 'tenant-1' });
    expect(call.select.passwordHash).toBeUndefined();
    expect(result).toEqual({
      id: 'user-1',
      email: 'user@example.com',
      name: 'Old Name',
      phone: '123',
      status: 'ACTIVE',
      kycStatus: 'PENDING',
      riskStatus: 'NORMAL',
    });
  });

  it('reports NOT_FOUND when the row is absent', async () => {
    usersDb.findFirst.mockResolvedValue(null);
    const useCase = new GetMeUseCase(new UsersRepository());

    await expect(useCase.execute(userContext())).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      reasonKey: 'user_not_found',
    });
  });

  it('rejects non-USER callers', async () => {
    const useCase = new GetMeUseCase(new UsersRepository());
    await expect(
      useCase.execute(userContext({ ownerType: 'TENANT_ADMIN', tenantId: 'tenant-1' })),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
    expect(usersDb.findFirst).not.toHaveBeenCalled();
  });
});

describe('UpdateMeUseCase', () => {
  it('updates name/phone, audits, and returns the fresh profile', async () => {
    usersDb.findFirst
      .mockResolvedValueOnce(profileRow())
      .mockResolvedValueOnce(profileRow({ name: 'New Name', phone: '999' }));
    usersDb.updateMany.mockResolvedValue({ count: 1 });
    const useCase = new UpdateMeUseCase(new UsersRepository());

    const result = await useCase.execute(userContext(), { name: ' New Name ', phone: '999' });

    expect(usersDb.updateMany.mock.calls[0]![0]).toMatchObject({
      where: { id: 'user-1', siteId: 'site-1', tenantId: 'tenant-1' },
      data: { name: 'New Name', phone: '999' },
    });
    expect(result.name).toBe('New Name');
    expect(auditCreate.mock.calls[0]![0].data).toMatchObject({
      actorType: 'USER',
      action: 'user.update_profile',
      targetId: 'user-1',
    });
  });

  it('treats a blank field as cleared (null) and keeps omitted fields unchanged', async () => {
    usersDb.findFirst
      .mockResolvedValueOnce(profileRow({ name: 'Old Name', phone: '123' }))
      .mockResolvedValueOnce(profileRow({ name: null, phone: '123' }));
    usersDb.updateMany.mockResolvedValue({ count: 1 });
    const useCase = new UpdateMeUseCase(new UsersRepository());

    await useCase.execute(userContext(), { name: '   ' });

    expect(usersDb.updateMany.mock.calls[0]![0].data).toEqual({ name: null, phone: '123' });
  });

  it('rejects an over-length name', async () => {
    usersDb.findFirst.mockResolvedValueOnce(profileRow());
    const useCase = new UpdateMeUseCase(new UsersRepository());

    await expect(
      useCase.execute(userContext(), { name: 'x'.repeat(101) }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, reasonKey: 'invalid_name' });
    expect(usersDb.updateMany).not.toHaveBeenCalled();
  });
});
