import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

const db = vi.hoisted(() => {
  const migrationFindUnique = vi.fn();
  const observationCreate = vi.fn();
  const migrationUpdate = vi.fn();
  const migrationUpdateMany = vi.fn();
  const auditCreate = vi.fn();
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback({
    dedicated_line_smoke_observations: { create: observationCreate },
    dedicated_line_migrations: { update: migrationUpdate, updateMany: migrationUpdateMany },
    audit_logs: { create: auditCreate },
  }));
  return { migrationFindUnique, observationCreate, migrationUpdate, migrationUpdateMany, auditCreate, transaction };
});

vi.mock('@ipeasy/db', () => ({ prisma: { dedicated_line_migrations: { findUnique: db.migrationFindUnique }, $transaction: db.transaction } }));

import { ProcessMigrationSmokeUseCase } from './process-migration-smoke.use-case';

beforeEach(() => {
  vi.clearAllMocks();
  db.migrationUpdateMany.mockResolvedValue({ count: 1 });
  db.migrationFindUnique.mockResolvedValue({
    id: 'migration-1', siteId: 'site-1', tenantId: 'tenant-1', userId: 'user-1', dedicatedLineId: 'line-1',
    type: 'FULL', phase: 'VERIFY', status: 'ACTIVE', targetExit: null, nodes: [],
    dedicatedLine: { countryCode: 'HK', domains: [{ hostname: 'canary.example.com', port: 443, role: 'BACKUP' }] },
    smokeObservations: [],
  });
  db.observationCreate.mockImplementation(async ({ data }) => ({ id: 'observation-1', ...data }));
});

describe('ProcessMigrationSmokeUseCase', () => {
  it('records verified smoke and advances the migration', async () => {
    const adapter = { verify: vi.fn().mockResolvedValue({ verified: true, observedIp: '203.0.113.9', observedCountry: 'HK', latencyMs: 20, stabilitySamples: 3, failureCode: null, detail: {} }) };
    const useCase = new ProcessMigrationSmokeUseCase(adapter as never);

    await expect(useCase.execute('migration-1', 'CANARY')).resolves.toMatchObject({ verified: true });
    expect(db.migrationUpdateMany).toHaveBeenCalledWith({
      where: { id: 'migration-1', phase: 'VERIFY', status: 'ACTIVE' },
      data: { phase: 'CUTOVER_ROUTE', status: 'ACTIVE' },
    });
    expect(db.migrationUpdate).not.toHaveBeenCalled();
    expect(db.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'dedicated_line.migration.smoke', targetId: 'migration-1', actorType: 'SYSTEM',
    }) });
  });

  it('records a retryable timeout observation and leaves the migration in VERIFY', async () => {
    const adapter = { verify: vi.fn().mockRejectedValue(new AppError(ErrorCode.UPSTREAM_TIMEOUT, 'dedicated_line_migration_smoke_timeout', 504)) };
    const useCase = new ProcessMigrationSmokeUseCase(adapter as never);

    await expect(useCase.execute('migration-1', 'CANARY')).resolves.toMatchObject({
      verified: false,
      failureType: 'TIMEOUT',
    });
    expect(db.observationCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      verified: false, failureType: 'TIMEOUT', failureDetail: expect.objectContaining({ reasonKey: 'dedicated_line_migration_smoke_timeout' }),
    }) }));
    expect(db.migrationUpdate).not.toHaveBeenCalled();
  });

  it('records smoke evidence without reviving a migration cancelled during the remote check', async () => {
    db.migrationUpdateMany.mockResolvedValueOnce({ count: 0 });
    const adapter = { verify: vi.fn().mockResolvedValue({ verified: true, observedIp: '203.0.113.9', observedCountry: 'HK', latencyMs: 20, stabilitySamples: 3, failureCode: null, detail: {} }) };
    const useCase = new ProcessMigrationSmokeUseCase(adapter as never);

    await expect(useCase.execute('migration-1', 'CANARY')).resolves.toMatchObject({ verified: true });
    expect(db.migrationUpdateMany).toHaveBeenCalledWith({
      where: { id: 'migration-1', phase: 'VERIFY', status: 'ACTIVE' },
      data: { phase: 'CUTOVER_ROUTE', status: 'ACTIVE' },
    });
    expect(db.migrationUpdate).not.toHaveBeenCalled();
  });

  it('does not turn an unknown programming failure into a smoke observation', async () => {
    const adapter = { verify: vi.fn().mockRejectedValue(new TypeError('broken adapter')) };
    const useCase = new ProcessMigrationSmokeUseCase(adapter as never);

    await expect(useCase.execute('migration-1', 'CANARY')).rejects.toThrow('broken adapter');
    expect(db.observationCreate).not.toHaveBeenCalled();
  });

  it('replays verified evidence without repeating the remote smoke or transition', async () => {
    const existing = { id: 'observation-existing', verified: true, stage: 'CANARY', failureType: null, freshUntil: new Date(Date.now() + 60_000) };
    db.migrationFindUnique.mockResolvedValueOnce({
      ...(await db.migrationFindUnique()),
      phase: 'CUTOVER_ROUTE',
      smokeObservations: [existing],
    });
    const adapter = { verify: vi.fn() };
    const useCase = new ProcessMigrationSmokeUseCase(adapter as never);

    await expect(useCase.execute('migration-1', 'CANARY')).resolves.toBe(existing);
    expect(adapter.verify).not.toHaveBeenCalled();
    expect(db.observationCreate).not.toHaveBeenCalled();
    expect(db.migrationUpdate).not.toHaveBeenCalled();
  });

  it('re-runs the remote smoke when the latest verified evidence is stale', async () => {
    const stale = { id: 'observation-stale', verified: true, stage: 'CANARY', failureType: null, freshUntil: new Date(Date.now() - 60_000) };
    db.migrationFindUnique.mockResolvedValueOnce({
      ...(await db.migrationFindUnique()),
      smokeObservations: [stale],
    });
    const adapter = { verify: vi.fn().mockResolvedValue({ verified: true, observedIp: '203.0.113.9', observedCountry: 'HK', latencyMs: 20, stabilitySamples: 3, failureCode: null, detail: {} }) };
    const useCase = new ProcessMigrationSmokeUseCase(adapter as never);

    await expect(useCase.execute('migration-1', 'CANARY')).resolves.toMatchObject({ verified: true });
    expect(adapter.verify).toHaveBeenCalledOnce();
    expect(db.observationCreate).toHaveBeenCalledOnce();
  });

  it('records a country mismatch and does not advance the migration', async () => {
    const adapter = { verify: vi.fn().mockResolvedValue({ verified: true, observedIp: '203.0.113.9', observedCountry: 'US', latencyMs: 20, stabilitySamples: 3, failureCode: null, detail: {} }) };
    const useCase = new ProcessMigrationSmokeUseCase(adapter as never);

    await expect(useCase.execute('migration-1', 'CANARY')).resolves.toMatchObject({
      verified: false,
      failureType: 'COUNTRY_MISMATCH',
    });
    expect(db.migrationUpdateMany).not.toHaveBeenCalled();
  });
});
