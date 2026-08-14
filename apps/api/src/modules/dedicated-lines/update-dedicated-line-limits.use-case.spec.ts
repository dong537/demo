import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticatedContext } from '../../common/auth/auth-context';

const db = vi.hoisted(() => {
  const lineFindFirst = vi.fn();
  const lineUpdate = vi.fn();
  const projectionsUpdateMany = vi.fn();
  const jobCreate = vi.fn();
  const auditCreate = vi.fn();
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback({
    dedicated_lines: { findFirst: lineFindFirst, update: lineUpdate },
    dedicated_line_projections: { updateMany: projectionsUpdateMany },
    external_jobs: { create: jobCreate },
    audit_logs: { create: auditCreate },
  }));
  return { lineFindFirst, lineUpdate, projectionsUpdateMany, jobCreate, auditCreate, transaction };
});

vi.mock('@ipeasy/db', () => ({ prisma: { $transaction: db.transaction } }));

const projection = vi.hoisted(() => ({
  build: vi.fn(() => ({ lifecycle: { trafficLimitBytes: 10 } })),
  hash: vi.fn(() => 'desired-hash-v2'),
}));

vi.mock('../dedicated-line-projections/build-managed-line-projection-request', () => ({
  buildManagedLineProjectionRequest: projection.build,
}));
vi.mock('../dedicated-line-projections/domain', () => ({
  managedLineProjectionDesiredHash: projection.hash,
}));

import { UpdateDedicatedLineLimitsUseCase } from './update-dedicated-line-limits.use-case';

const INPUT = {
  trafficLimitBytes: 10_000,
  uplinkLimitBps: 131_072,
  downlinkLimitBps: 524_288,
  maxConnections: 32,
  ipLimit: 2,
  reason: 'customer plan limits',
};

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

function line(overrides: Record<string, unknown> = {}) {
  return {
    id: 'line-1',
    siteId: 'site-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    status: 'ACTIVE',
    desiredVersion: 1,
    protocol: 'VLESS',
    clientEmail: 'line@example.com',
    clientIdentityCiphertext: 'client-ciphertext',
    expiresAt: new Date('2026-09-01T00:00:00.000Z'),
    quotaBytes: 1_000n,
    uplinkLimitBps: 1_024n,
    downlinkLimitBps: 2_048n,
    maxConnections: 4,
    ipLimit: 1,
    inboundProfile: { inboundTag: 'sv-hk-1' },
    exitAssignment: {
      status: 'ACTIVE',
      residentialExit: {
        status: 'ASSIGNED',
        endpointCiphertext: 'endpoint-ciphertext',
        credentialCiphertext: 'credential-ciphertext',
      },
    },
    projections: [
      { id: 'projection-1', nodeId: 'node-1' },
      { id: 'projection-2', nodeId: 'node-2' },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.lineFindFirst.mockResolvedValue(line());
  db.lineUpdate.mockResolvedValue({});
  db.projectionsUpdateMany.mockResolvedValue({ count: 2 });
  db.jobCreate.mockResolvedValue({});
  db.auditCreate.mockResolvedValue({});
});

describe('UpdateDedicatedLineLimitsUseCase', () => {
  it('updates all limits, queues every projection, and writes one audit row', async () => {
    const result = await new UpdateDedicatedLineLimitsUseCase(config()).execute(context(), 'line-1', INPUT);

    expect(db.lineFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'line-1', siteId: 'site-1' },
    }));
    expect(projection.build).toHaveBeenCalledWith(expect.objectContaining({
      desiredVersion: 2,
      quotaBytes: 10_000n,
      uplinkLimitBps: 131_072n,
      downlinkLimitBps: 524_288n,
      maxConnections: 32,
      ipLimit: 2,
    }), 'encryption-key');
    expect(db.lineUpdate).toHaveBeenCalledWith({
      where: { id: 'line-1' },
      data: {
        quotaBytes: 10_000n,
        uplinkLimitBps: 131_072n,
        downlinkLimitBps: 524_288n,
        maxConnections: 32,
        ipLimit: 2,
        desiredVersion: 2,
      },
    });
    expect(db.jobCreate).toHaveBeenCalledTimes(2);
    expect(db.jobCreate).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        aggregateId: 'projection-1',
        desiredVersion: 2,
        idempotencyKey: 'projection:line-1:node-1:v2',
        dedupeKey: 'projection:line-1:node-1:v2',
      }),
    });
    expect(db.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        siteId: 'site-1',
        tenantId: 'tenant-1',
        actorType: 'ADMIN_USER',
        actorId: 'admin-1',
        targetType: 'dedicated_lines',
        targetId: 'line-1',
        action: 'dedicated_line.limits.update',
        reason: INPUT.reason,
        requestId: 'request-1',
        meta: expect.objectContaining({ desiredVersion: 2 }),
      }),
    });
    expect(result).toEqual({
      lineId: 'line-1',
      desiredVersion: 2,
      limits: INPUT_WITHOUT_REASON,
      replayed: false,
    });
  });

  it('treats nullable database limits as zero and replays without side effects', async () => {
    db.lineFindFirst.mockResolvedValue(line({
      quotaBytes: null,
      uplinkLimitBps: null,
      downlinkLimitBps: null,
      maxConnections: null,
      ipLimit: null,
    }));
    const unlimited = { ...INPUT_WITHOUT_REASON, trafficLimitBytes: 0, uplinkLimitBps: 0, downlinkLimitBps: 0, maxConnections: 0, ipLimit: 0, reason: 'keep unlimited' };

    const result = await new UpdateDedicatedLineLimitsUseCase(config()).execute(context(), 'line-1', unlimited);

    expect(result).toEqual({ lineId: 'line-1', desiredVersion: 1, limits: INPUT_ZERO, replayed: true });
    expect(projection.build).not.toHaveBeenCalled();
    expect(db.lineUpdate).not.toHaveBeenCalled();
    expect(db.jobCreate).not.toHaveBeenCalled();
    expect(db.auditCreate).not.toHaveBeenCalled();
  });

  it('rejects legacy database limits that cannot be represented without precision loss', async () => {
    db.lineFindFirst.mockResolvedValue(line({ quotaBytes: BigInt(Number.MAX_SAFE_INTEGER) + 1n }));

    await expect(new UpdateDedicatedLineLimitsUseCase(config()).execute(
      context(),
      'line-1',
      INPUT,
    )).rejects.toMatchObject({
      reasonKey: 'dedicated_line_limit_out_of_range',
      httpStatus: 422,
    });
    expect(db.lineUpdate).not.toHaveBeenCalled();
    expect(db.auditCreate).not.toHaveBeenCalled();
  });

  it('scopes tenant administrators to their own tenant', async () => {
    await new UpdateDedicatedLineLimitsUseCase(config()).execute(
      context({ ownerType: 'TENANT_ADMIN', tenantId: 'tenant-1' }),
      'line-1',
      INPUT,
    );

    expect(db.lineFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'line-1', siteId: 'site-1', tenantId: 'tenant-1' },
    }));
  });

  it('rejects non-admin callers before opening a transaction', async () => {
    await expect(new UpdateDedicatedLineLimitsUseCase(config()).execute(
      context({ ownerType: 'USER', tenantId: 'tenant-1' }),
      'line-1',
      INPUT,
    )).rejects.toMatchObject({ reasonKey: 'admin_only', httpStatus: 403 });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects terminal lines and lines without projections', async () => {
    db.lineFindFirst.mockResolvedValueOnce(line({ status: 'CANCELLED' }));
    const useCase = new UpdateDedicatedLineLimitsUseCase(config());
    await expect(useCase.execute(context(), 'line-1', INPUT)).rejects.toMatchObject({
      reasonKey: 'dedicated_line_limits_not_mutable',
      httpStatus: 422,
    });

    db.lineFindFirst.mockResolvedValueOnce(line({ projections: [] }));
    await expect(useCase.execute(context(), 'line-1', INPUT)).rejects.toMatchObject({
      reasonKey: 'dedicated_line_projection_missing',
      httpStatus: 422,
    });
  });

  it.each([
    [{ ...INPUT, trafficLimitBytes: -1 }, 'dedicated_line_traffic_limit_invalid'],
    [{ ...INPUT, uplinkLimitBps: Number.MAX_SAFE_INTEGER + 1 }, 'dedicated_line_uplink_limit_invalid'],
    [{ ...INPUT, downlinkLimitBps: 1.5 }, 'dedicated_line_downlink_limit_invalid'],
    [{ ...INPUT, maxConnections: 2_147_483_648 }, 'dedicated_line_connection_limit_invalid'],
    [{ ...INPUT, ipLimit: -1 }, 'dedicated_line_ip_limit_invalid'],
    [{ ...INPUT, reason: ' ' }, 'reason_required'],
  ])('rejects invalid complete replacement input', async (input, reasonKey) => {
    await expect(new UpdateDedicatedLineLimitsUseCase(config()).execute(
      context(),
      'line-1',
      input,
    )).rejects.toMatchObject({ reasonKey });
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

const INPUT_WITHOUT_REASON = {
  trafficLimitBytes: 10_000,
  uplinkLimitBps: 131_072,
  downlinkLimitBps: 524_288,
  maxConnections: 32,
  ipLimit: 2,
};

const INPUT_ZERO = {
  trafficLimitBytes: 0,
  uplinkLimitBps: 0,
  downlinkLimitBps: 0,
  maxConnections: 0,
  ipLimit: 0,
};

function config() {
  return { get: vi.fn(() => 'encryption-key') } as never;
}
