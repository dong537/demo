import { describe, expect, it, vi } from 'vitest';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { UpstreamLogRepository } from '../providers/upstream-log.repository';
import { ListUpstreamLogsUseCase } from './list-upstream-logs.use-case';

function authContext(overrides: Partial<AuthenticatedContext> = {}): AuthenticatedContext {
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

function createUseCase() {
  const repo = {
    listForSite: vi.fn<UpstreamLogRepository['listForSite']>(),
  };
  const useCase = new ListUpstreamLogsUseCase(repo as unknown as UpstreamLogRepository);
  return { useCase, repo };
}

describe('ListUpstreamLogsUseCase', () => {
  it('lets PLATFORM_ADMIN list logs scoped to their site with filters passed through', async () => {
    const { useCase, repo } = createUseCase();
    repo.listForSite.mockResolvedValue({ page: 1, pageSize: 20, total: 0, items: [] });

    await useCase.execute(authContext(), {
      page: 1,
      pageSize: 20,
      providerCode: 'IPIPD',
      status: 'ERROR',
      from: '2026-06-01',
      to: '2026-06-09',
    });

    expect(repo.listForSite).toHaveBeenCalledWith('site-1', {
      page: 1,
      pageSize: 20,
      providerCode: 'IPIPD',
      status: 'ERROR',
      from: '2026-06-01',
      to: '2026-06-09',
    });
  });

  it('rejects TENANT_ADMIN with PERMISSION_DENIED', async () => {
    const { useCase, repo } = createUseCase();

    await expect(
      useCase.execute(authContext({ ownerType: 'TENANT_ADMIN', tenantId: 'tenant-1' }), {}),
    ).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
      reasonKey: 'insufficient_permissions',
      httpStatus: 403,
    });
    expect(repo.listForSite).not.toHaveBeenCalled();
  });

  it('rejects USER callers with PERMISSION_DENIED', async () => {
    const { useCase, repo } = createUseCase();

    await expect(
      useCase.execute(authContext({ ownerType: 'USER', ownerId: 'user-1', tenantId: 'tenant-1' }), {}),
    ).rejects.toBeInstanceOf(AppError);
    expect(repo.listForSite).not.toHaveBeenCalled();
  });

  it('rejects SYSTEM callers with PERMISSION_DENIED', async () => {
    const { useCase, repo } = createUseCase();

    await expect(
      useCase.execute(authContext({ ownerType: 'SYSTEM' }), {}),
    ).rejects.toBeInstanceOf(AppError);
    expect(repo.listForSite).not.toHaveBeenCalled();
  });
});
