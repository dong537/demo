import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuthenticatedContext } from '../../common/auth/auth-context';

const db = vi.hoisted(() => {
  const migrationFindFirst = vi.fn();
  const migrationUpdate = vi.fn();
  const jobsFindMany = vi.fn();
  const jobsUpdateMany = vi.fn();
  const projectionsUpdateMany = vi.fn();
  const linesUpdateMany = vi.fn();
  const auditCreate = vi.fn();
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback({
    dedicated_line_migrations: { findFirst: migrationFindFirst, update: migrationUpdate },
    external_jobs: { findMany: jobsFindMany, updateMany: jobsUpdateMany },
    dedicated_line_projections: { updateMany: projectionsUpdateMany },
    dedicated_lines: { updateMany: linesUpdateMany },
    audit_logs: { create: auditCreate },
  }));
  return { migrationFindFirst, migrationUpdate, jobsFindMany, jobsUpdateMany, projectionsUpdateMany, linesUpdateMany, auditCreate, transaction };
});

vi.mock('@ipeasy/db', () => ({ prisma: { $transaction: db.transaction } }));

import { RetryDedicatedLineMigrationUseCase } from './retry-migration.use-case';

const ctx: AuthenticatedContext = { ownerId: 'admin-1', ownerType: 'PLATFORM_ADMIN', siteId: 'site-1', tenantId: null, scopes: [], requestId: 'req-1' };

beforeEach(() => {
  vi.clearAllMocks();
  db.migrationFindFirst.mockResolvedValue({
    id: 'migration-1', siteId: 'site-1', tenantId: 'tenant-1', dedicatedLineId: 'line-1',
    phase: 'PREPARE', status: 'NEEDS_OPERATOR', reason: 'node move',
  });
  db.jobsFindMany.mockResolvedValue([
    { id: 'apply-job', kind: 'APPLY_DEDICATED_LINE_PROJECTION', aggregateType: 'dedicated_line_projection', aggregateId: 'projection-1', payload: { migrationId: 'migration-1' } },
    { id: 'other-job', kind: 'APPLY_DEDICATED_LINE_PROJECTION', aggregateType: 'dedicated_line_projection', aggregateId: 'projection-2', payload: { migrationId: 'migration-other' } },
  ]);
  db.jobsUpdateMany.mockResolvedValue({ count: 1 });
});

describe('RetryDedicatedLineMigrationUseCase', () => {
  it('requeues only failed work owned by the migration and restores staged projections', async () => {
    const result = await new RetryDedicatedLineMigrationUseCase().execute(ctx, 'migration-1', { reason: 'credentials rotated' });

    expect(result).toEqual({ migrationId: 'migration-1', phase: 'PREPARE', status: 'ACTIVE', requeuedJobs: 1 });
    expect(db.jobsUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['apply-job'] }, status: { in: ['FAILED', 'NEEDS_OPERATOR'] } },
      data: expect.objectContaining({ status: 'QUEUED', attempt: 0, leaseOwner: null, completedAt: null }),
    }));
    expect(db.projectionsUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['projection-1'] }, dedicatedLineId: 'line-1' },
      data: expect.objectContaining({ status: 'PENDING' }),
    }));
    expect(db.migrationUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'ACTIVE', lastErrorCode: null }),
    }));
    expect(db.auditCreate).toHaveBeenCalled();
  });

  it('does not turn rollback evidence into an automatic retry', async () => {
    db.migrationFindFirst.mockResolvedValueOnce({
      id: 'migration-1', siteId: 'site-1', tenantId: 'tenant-1', dedicatedLineId: 'line-1',
      phase: 'ROLLBACK', status: 'NEEDS_OPERATOR', reason: 'node move',
    });

    await expect(new RetryDedicatedLineMigrationUseCase().execute(ctx, 'migration-1', { reason: 'retry' })).rejects.toMatchObject({
      reasonKey: 'migration_rollback_route_required',
    });
    expect(db.jobsUpdateMany).not.toHaveBeenCalled();
  });

  it('restores a committed line to provisioning before retrying cleanup apply work', async () => {
    db.migrationFindFirst.mockResolvedValueOnce({
      id: 'migration-1', siteId: 'site-1', tenantId: 'tenant-1', dedicatedLineId: 'line-1',
      phase: 'CLEANUP', status: 'NEEDS_OPERATOR', reason: 'node move', committedAt: new Date(),
    });

    await new RetryDedicatedLineMigrationUseCase().execute(ctx, 'migration-1', { reason: 'credentials rotated' });

    expect(db.linesUpdateMany).toHaveBeenCalledWith({
      where: { id: 'line-1', activeMigrationId: 'migration-1', status: 'FAILED' },
      data: { status: 'PROVISIONING' },
    });
  });

  it('does not replay obsolete APPLY work while retrying cancelled cleanup', async () => {
    db.migrationFindFirst.mockResolvedValueOnce({
      id: 'migration-1', siteId: 'site-1', tenantId: 'tenant-1', dedicatedLineId: 'line-1',
      phase: 'CLEANUP', status: 'NEEDS_OPERATOR', reason: 'node move', committedAt: null,
    });
    db.jobsFindMany.mockResolvedValueOnce([
      { id: 'apply-job', kind: 'APPLY_DEDICATED_LINE_PROJECTION', aggregateType: 'dedicated_line_projection', aggregateId: 'projection-1', payload: { migrationId: 'migration-1' } },
      { id: 'delete-job', kind: 'DELETE_DEDICATED_LINE_PROJECTION', aggregateType: 'dedicated_line_projection', aggregateId: 'projection-1', payload: { migrationId: 'migration-1' } },
    ]);

    await expect(new RetryDedicatedLineMigrationUseCase().execute(ctx, 'migration-1', { reason: 'retry delete' })).resolves.toMatchObject({
      status: 'CANCELLED', requeuedJobs: 1,
    });

    expect(db.jobsUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['delete-job'] }, status: { in: ['FAILED', 'NEEDS_OPERATOR'] } },
    }));
    expect(db.projectionsUpdateMany).not.toHaveBeenCalled();
    expect(db.migrationUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CANCELLED' }),
    }));
  });
});
