import { describe, expect, it, vi, beforeEach } from 'vitest';
import { prisma } from '@ipeasy/db';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { ApiKeysRepository, ApiKey } from '../api-keys.repository';
import { CreateApiKeyUseCase } from './create-api-key.use-case';

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
    create: vi.fn<ApiKeysRepository['create']>(),
  };
  const useCase = new CreateApiKeyUseCase(repo as unknown as ApiKeysRepository);
  return { useCase, repo };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CreateApiKeyUseCase', () => {
  it('trims and persists the API key name without returning sensitive hash', async () => {
    const { useCase, repo } = createUseCase();
    repo.create.mockResolvedValue(apiKey({ name: 'Order automation' }));

    const result = await useCase.execute(authContext(), {
      tenantId: 'tenant-1',
      name: '  Order automation  ',
      scopes: ['res_static:*'],
      ipWhitelist: [],
    });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: 'site-1',
        tenantId: 'tenant-1',
        ownerId: 'user-1',
        ownerType: 'USER',
        name: 'Order automation',
        scopes: ['res_static:*'],
        ipWhitelist: [],
      }),
    );
    expect(result.name).toBe('Order automation');
    expect(result.plainKey).toBeTypeOf('string');
    expect(result).not.toHaveProperty('keyHash');
    expect(prisma.audit_logs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'api_key.create',
          targetId: 'key-1',
        }),
      }),
    );
  });

  it('rejects blank names before creating a key', async () => {
    const { useCase, repo } = createUseCase();

    await expect(
      useCase.execute(authContext(), {
        tenantId: 'tenant-1',
        name: '   ',
        scopes: ['res_static:*'],
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      reasonKey: 'api_key_name_required',
      httpStatus: 400,
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects empty scopes before creating a key', async () => {
    const { useCase, repo } = createUseCase();

    await expect(
      useCase.execute(authContext(), {
        tenantId: 'tenant-1',
        name: 'Order automation',
        scopes: [],
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect(repo.create).not.toHaveBeenCalled();
  });
});
