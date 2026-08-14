import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticatedContext } from '../../common/auth/auth-context';

const db = vi.hoisted(() => ({ count: vi.fn(), findMany: vi.fn() }));

vi.mock('@ipeasy/db', () => ({
  prisma: { dedicated_lines: { count: db.count, findMany: db.findMany } },
}));

import { ListDedicatedLineLimitsUseCase } from './list-dedicated-line-limits.use-case';

function context(overrides: Partial<AuthenticatedContext> = {}): AuthenticatedContext {
  return {
    ownerId: 'admin-1',
    ownerType: 'PLATFORM_ADMIN',
    siteId: 'site-1',
    tenantId: null,
    scopes: [],
    requestId: 'request-1',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.count.mockResolvedValue(21);
  db.findMany.mockResolvedValue([{
    id: 'line-1', tenantId: 'tenant-1', userId: 'user-1', status: 'ACTIVE', countryCode: 'HK', protocol: 'VLESS', desiredVersion: 3,
    quotaBytes: 10_000n, uplinkLimitBps: 131_072n, downlinkLimitBps: 524_288n, maxConnections: 32, ipLimit: 2,
    user: { email: 'customer@example.com', name: 'Customer' },
    sku: { code: 'SV', name: 'Short video' },
    inboundProfile: { inboundTag: 'sv-hk-1' },
    projections: [{ status: 'READY' }, { status: 'PENDING' }],
  }]);
});

describe('ListDedicatedLineLimitsUseCase', () => {
  it('lists site-scoped lines with lossless limit strings and projection readiness', async () => {
    const result = await new ListDedicatedLineLimitsUseCase().execute(context(), { page: 2, pageSize: 20 });

    expect(db.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { siteId: 'site-1' },
      orderBy: { createdAt: 'desc' },
      skip: 20,
      take: 20,
    }));
    expect(result).toEqual({
      page: 2,
      pageSize: 20,
      total: 21,
      items: [{
        id: 'line-1', tenantId: 'tenant-1', userId: 'user-1', status: 'ACTIVE', countryCode: 'HK', protocol: 'VLESS', desiredVersion: 3,
        customer: { email: 'customer@example.com', name: 'Customer' },
        sku: { code: 'SV', name: 'Short video' },
        inboundTag: 'sv-hk-1',
        limits: { trafficLimitBytes: '10000', uplinkLimitBps: '131072', downlinkLimitBps: '524288', maxConnections: 32, ipLimit: 2 },
        projections: { ready: 1, total: 2 },
      }],
    });
  });

  it('scopes tenant administrators to their tenant', async () => {
    await new ListDedicatedLineLimitsUseCase().execute(context({ ownerType: 'TENANT_ADMIN', tenantId: 'tenant-1' }), {});
    expect(db.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { siteId: 'site-1', tenantId: 'tenant-1' },
    }));
  });

  it('rejects non-admin callers without querying', async () => {
    await expect(new ListDedicatedLineLimitsUseCase().execute(
      context({ ownerType: 'USER', tenantId: 'tenant-1' }), {},
    )).rejects.toMatchObject({ reasonKey: 'admin_only', httpStatus: 403 });
    expect(db.count).not.toHaveBeenCalled();
    expect(db.findMany).not.toHaveBeenCalled();
  });
});
