import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticatedContext } from '../../common/auth/auth-context';

const db = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('@ipeasy/db', () => ({
  prisma: { dedicated_lines: { findMany: db.findMany } },
}));

import { DedicatedLineDeliveryUseCase } from './dedicated-line-delivery.use-case';

const ctx: AuthenticatedContext = {
  ownerId: 'user-1',
  ownerType: 'USER',
  siteId: 'site-1',
  tenantId: 'tenant-1',
  scopes: [],
  requestId: 'request-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  db.findMany.mockResolvedValue([{
    id: 'line-1',
    status: 'PROVISIONING',
    countryCode: 'HK',
    protocol: 'VLESS',
    expiresAt: null,
    clientIdentityCiphertext: 'unused',
    clientEmail: 'line@example.com',
    quotaBytes: 9_007_199_254_740_993n,
    uplinkLimitBps: 131_072n,
    downlinkLimitBps: 524_288n,
    maxConnections: 32,
    ipLimit: 2,
    inboundProfile: { inboundTag: 'sv-hk-1' },
    deliveryRoutes: [],
    projections: [{ status: 'PENDING' }],
  }]);
});

describe('DedicatedLineDeliveryUseCase', () => {
  it('returns BigInt limits as lossless decimal strings', async () => {
    const result = await new DedicatedLineDeliveryUseCase({ get: vi.fn() } as never).list(ctx);

    expect(result[0]?.limits).toEqual({
      trafficLimitBytes: '9007199254740993',
      uplinkLimitBps: '131072',
      downlinkLimitBps: '524288',
      maxConnections: 32,
      ipLimit: 2,
    });
  });
});
