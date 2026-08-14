import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@ipeasy/db';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { ErrorCode } from '../../../common/errors/error-codes';
import { ApiKeysRepository, ApiKey } from '../api-keys.repository';
import { RevokeApiKeyUseCase } from './revoke-api-key.use-case';

vi.mock('@ipeasy/db', () => ({
  prisma: {
    audit_logs: {
      create: vi.fn(),
    },
  },
}));

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
    findById: vi.fn<ApiKeysRepository['findById']>(),
    revoke: vi.fn<ApiKeysRepository['revoke']>(),
  };
  const useCase = new RevokeApiKeyUseCase(repo as unknown as ApiKeysRepository);
  return { useCase, repo };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RevokeApiKeyUseCase', () => {
  it('revokes the caller own key and writes an audit log', async () => {
    const { useCase, repo } = createUseCase();
    repo.findById.mockResolvedValue(apiKey());

    await useCase.execute(authContext(), 'key-1');

    expect(repo.revoke).toHaveBeenCalledWith('key-1');
    expect(prisma.audit_logs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'api_key.revoke', targetId: 'key-1' }),
      }),
    );
  });

  it('rejects revoking a key owned by another user', async () => {
    const { useCase, repo } = createUseCase();
    repo.findById.mockResolvedValue(apiKey({ ownerId: 'someone-else' }));

    await expect(useCase.execute(authContext(), 'key-1')).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
      reasonKey: 'insufficient_permissions',
      httpStatus: 403,
    });
    expect(repo.revoke).not.toHaveBeenCalled();
    expect(prisma.audit_logs.create).not.toHaveBeenCalled();
  });
});
