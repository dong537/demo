import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@ipeasy/db';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { ProxiesRepository } from './proxies.repository';

vi.mock('@ipeasy/db', () => ({
  prisma: {
    proxy_instances: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.proxy_instances.count).mockResolvedValue(0);
  vi.mocked(prisma.proxy_instances.findMany).mockResolvedValue([]);
});

describe('ProxiesRepository list filters', () => {
  it('builds customer proxy filters for country, search, status, and expiry range', async () => {
    const repo = new ProxiesRepository();

    await repo.findByUserId('user-1', 'site-1', 'tenant-1', {
      page: 2,
      pageSize: 10,
      status: 'ACTIVE',
      countryCode: 'HK',
      search: 'ORD_123',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
    });

    const where = countWhere();
    expect(where).toMatchObject({
      userId: 'user-1',
      siteId: 'site-1',
      tenantId: 'tenant-1',
      status: 'ACTIVE',
      countryCode: 'HK',
      OR: [
        { ip: { contains: 'ORD_123', mode: 'insensitive' } },
        { orderId: { contains: 'ORD_123', mode: 'insensitive' } },
        { upstreamProxyId: { contains: 'ORD_123', mode: 'insensitive' } },
        { countryCode: { contains: 'ORD_123', mode: 'insensitive' } },
      ],
    });
    const expiresAt = where.expiresAt as { gte?: Date; lte?: Date };
    expect(expiresAt.gte).toEqual(new Date('2026-07-01T00:00:00.000Z'));
    expect(expiresAt.lte).toEqual(new Date('2026-08-01T00:00:00.000Z'));
    expect(findManyArg()).toMatchObject({
      skip: 10,
      take: 10,
      orderBy: { createdAt: 'desc' },
    });
  });

  it('builds admin proxy filters for order id, user, search, tenant, and expiry range', async () => {
    const repo = new ProxiesRepository();

    await repo.listForAdmin('site-1', 'tenant-1', {
      page: 1,
      pageSize: 20,
      userId: 'user-2',
      orderId: 'order-1',
      search: 'UP_PROXY',
      from: '2026-07-01',
      to: '2026-07-31',
    });

    const where = countWhere();
    expect(where).toMatchObject({
      siteId: 'site-1',
      tenantId: 'tenant-1',
      userId: 'user-2',
      orderId: 'order-1',
      OR: [
        { ip: { contains: 'UP_PROXY', mode: 'insensitive' } },
        { orderId: { contains: 'UP_PROXY', mode: 'insensitive' } },
        { upstreamProxyId: { contains: 'UP_PROXY', mode: 'insensitive' } },
        { countryCode: { contains: 'UP_PROXY', mode: 'insensitive' } },
        { userId: { contains: 'UP_PROXY', mode: 'insensitive' } },
      ],
    });
    const expiresAt = where.expiresAt as { gte?: Date; lte?: Date };
    expect(expiresAt.gte).toEqual(new Date('2026-07-01'));
    expect(expiresAt.lte).toEqual(new Date('2026-07-31'));
  });

  it('rejects invalid expiry range dates as validation errors', async () => {
    const repo = new ProxiesRepository();

    await expect(repo.findByUserId('user-1', 'site-1', 'tenant-1', { from: 'not-a-date' }))
      .rejects
      .toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        reasonKey: 'from_invalid',
      } satisfies Partial<AppError>);
    expect(prisma.proxy_instances.count).not.toHaveBeenCalled();
  });
});

function countWhere() {
  return vi.mocked(prisma.proxy_instances.count).mock.calls[0]?.[0]?.where ?? {};
}

function findManyArg() {
  return vi.mocked(prisma.proxy_instances.findMany).mock.calls[0]?.[0] ?? {};
}
