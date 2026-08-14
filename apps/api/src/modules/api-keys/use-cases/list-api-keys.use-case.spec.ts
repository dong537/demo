import { describe, expect, it, vi } from 'vitest';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { ApiKeysRepository, ApiKey } from '../api-keys.repository';
import { ListApiKeysUseCase } from './list-api-keys.use-case';

function authContext(overrides: Partial<AuthenticatedContext> = {}): AuthenticatedContext {
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

function apiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  const now = new Date('2026-06-08T00:00:00.000Z');
  return {
    id: 'key-1',
    siteId: 'site-1',
    tenantId: 'tenant-1',
    ownerId: 'user-1',
    ownerType: 'USER',
    name: 'Order automation',
    keyHash: 'secret-hash',
    keyPrefix: 'abcd1234',
    scopes: ['res_static:*'],
    ipWhitelist: [],
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
    revokedAt: null,
    lastUsedAt: null,
    ...overrides,
  } as ApiKey;
}

function createUseCase() {
  const repo = {
    listForOwner: vi.fn<ApiKeysRepository['listForOwner']>(),
  };
  const useCase = new ListApiKeysUseCase(repo as unknown as ApiKeysRepository);
  return { useCase, repo };
}

describe('ListApiKeysUseCase', () => {
  it('filters by ownerId, siteId, tenantId and returns a sanitized page', async () => {
    const { useCase, repo } = createUseCase();
    repo.listForOwner.mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 1,
      items: [apiKey()],
    });

    const result = await useCase.execute(authContext(), { page: 1, pageSize: 20 });

    expect(repo.listForOwner).toHaveBeenCalledWith(
      { ownerId: 'user-1', siteId: 'site-1', tenantId: 'tenant-1' },
      { page: 1, pageSize: 20 },
    );
    expect(result.total).toBe(1);
    const item = result.items[0]!;
    expect(item).toEqual({
      id: 'key-1',
      name: 'Order automation',
      keyPrefix: 'abcd1234',
      scopes: ['res_static:*'],
      ipWhitelist: [],
      status: 'ACTIVE',
      createdAt: new Date('2026-06-08T00:00:00.000Z'),
      lastUsedAt: null,
      revokedAt: null,
    });
    // never leak sensitive fields
    expect(item).not.toHaveProperty('keyHash');
    expect(item).not.toHaveProperty('plainKey');
  });

  it('allows TENANT_ADMIN to list their own keys', async () => {
    const { useCase, repo } = createUseCase();
    repo.listForOwner.mockResolvedValue({ page: 1, pageSize: 20, total: 0, items: [] });

    await useCase.execute(authContext({ ownerType: 'TENANT_ADMIN', ownerId: 'admin-1' }), {});

    expect(repo.listForOwner).toHaveBeenCalledWith(
      { ownerId: 'admin-1', siteId: 'site-1', tenantId: 'tenant-1' },
      {},
    );
  });

  it('rejects PLATFORM_ADMIN with PERMISSION_DENIED', async () => {
    const { useCase, repo } = createUseCase();

    await expect(
      useCase.execute(authContext({ ownerType: 'PLATFORM_ADMIN' }), {}),
    ).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
      reasonKey: 'insufficient_permissions',
      httpStatus: 403,
    });
    expect(repo.listForOwner).not.toHaveBeenCalled();
  });

  it('rejects SYSTEM callers with PERMISSION_DENIED', async () => {
    const { useCase, repo } = createUseCase();

    await expect(useCase.execute(authContext({ ownerType: 'SYSTEM' }), {})).rejects.toBeInstanceOf(
      AppError,
    );
    expect(repo.listForOwner).not.toHaveBeenCalled();
  });

  it('rejects when tenant context is missing', async () => {
    const { useCase, repo } = createUseCase();

    await expect(useCase.execute(authContext({ tenantId: null }), {})).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
      reasonKey: 'insufficient_permissions',
    });
    expect(repo.listForOwner).not.toHaveBeenCalled();
  });
});
