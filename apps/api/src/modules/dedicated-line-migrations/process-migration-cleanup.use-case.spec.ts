import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const migrationFindUnique = vi.fn();
  const migrationUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const lineFindUnique = vi.fn();
  const lineUpdateMany = vi.fn();
  const projectionFindMany = vi.fn();
  const projectionDeleteMany = vi.fn();
  const jobFindMany = vi.fn();
  const migrationNodeUpdateMany = vi.fn();
  const nodeUpdateMany = vi.fn();
  const exitUpdateMany = vi.fn();
  const auditCreate = vi.fn();
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback({
    dedicated_line_migrations: { findUnique: migrationFindUnique, updateMany: migrationUpdateMany },
    dedicated_lines: { findUnique: lineFindUnique, updateMany: lineUpdateMany },
    dedicated_line_projections: { findMany: projectionFindMany, deleteMany: projectionDeleteMany },
    external_jobs: { findMany: jobFindMany },
    dedicated_line_migration_nodes: { updateMany: migrationNodeUpdateMany },
    control_nodes: { updateMany: nodeUpdateMany },
    residential_exits: { updateMany: exitUpdateMany },
    audit_logs: { create: auditCreate },
  }));
  return { migrationFindUnique, migrationUpdateMany, lineFindUnique, lineUpdateMany, projectionFindMany, projectionDeleteMany, jobFindMany, migrationNodeUpdateMany, nodeUpdateMany, exitUpdateMany, auditCreate, transaction };
});

vi.mock('@ipeasy/db', () => ({ prisma: { $transaction: db.transaction } }));

import { ProcessMigrationCleanupUseCase } from './process-migration-cleanup.use-case';

beforeEach(() => {
  vi.clearAllMocks();
  db.migrationFindUnique.mockResolvedValue({
    id: 'migration-1', siteId: 'site-1', tenantId: 'tenant-1', userId: 'user-1', dedicatedLineId: 'line-1', type: 'FULL', phase: 'CLEANUP', status: 'ACTIVE',
    committedAt: new Date(), sourceExitId: 'exit-old', targetExitId: 'exit-new', targetLineVersion: 2,
    finishedAt: null,
    nodes: [
      { id: 'source-node', nodeId: 'node-old', role: 'SOURCE', reservationStatus: 'RESERVED', projectionId: 'source-projection' },
      { id: 'target-node', nodeId: 'node-new', role: 'TARGET', reservationStatus: 'RESERVED', projectionId: 'target-projection' },
    ],
  });
  db.lineFindUnique.mockResolvedValue({ desiredVersion: 2, status: 'ACTIVE', activeMigrationId: 'migration-1', exitAssignment: { residentialExitId: 'exit-new' } });
  db.projectionFindMany.mockResolvedValue([
    { id: 'target-projection', status: 'READY', desiredVersion: 2, observedVersion: 2, migrationId: null },
  ]);
  db.jobFindMany.mockResolvedValue([{ aggregateId: 'source-projection', status: 'COMPLETED' }]);
  db.migrationNodeUpdateMany.mockResolvedValue({ count: 1 });
});

describe('ProcessMigrationCleanupUseCase', () => {
  it('waits without releasing resources until every remote delete completes', async () => {
    db.jobFindMany.mockResolvedValue([{ aggregateId: 'source-projection', status: 'RETRYING' }]);
    const useCase = new ProcessMigrationCleanupUseCase();

    await expect(useCase.execute('migration-1')).resolves.toEqual({ status: 'WAITING', migrationId: 'migration-1' });
    expect(db.nodeUpdateMany).not.toHaveBeenCalled();
    expect(db.exitUpdateMany).not.toHaveBeenCalled();
    expect(db.projectionDeleteMany).not.toHaveBeenCalled();
    expect(db.migrationUpdateMany).not.toHaveBeenCalled();
  });

  it('escalates a committed migration with a missing source projection link', async () => {
    db.migrationFindUnique.mockResolvedValueOnce({
      ...(await db.migrationFindUnique()),
      nodes: [
        { id: 'source-node', nodeId: 'node-old', role: 'SOURCE', reservationStatus: 'RELEASED', projectionId: null },
        { id: 'target-node', nodeId: 'node-new', role: 'TARGET', reservationStatus: 'RESERVED', projectionId: 'target-projection' },
      ],
    });
    const useCase = new ProcessMigrationCleanupUseCase();

    await expect(useCase.execute('migration-1')).rejects.toMatchObject({
      reasonKey: 'migration_source_projection_link_missing',
    });
    expect(db.nodeUpdateMany).not.toHaveBeenCalled();
    expect(db.exitUpdateMany).not.toHaveBeenCalled();
    expect(db.projectionDeleteMany).not.toHaveBeenCalled();
  });

  it('waits until every post-commit target projection is ready and the line is active', async () => {
    db.lineFindUnique.mockResolvedValueOnce({ desiredVersion: 2, status: 'PROVISIONING', activeMigrationId: 'migration-1', exitAssignment: { residentialExitId: 'exit-new' } });
    const useCase = new ProcessMigrationCleanupUseCase();

    await expect(useCase.execute('migration-1')).resolves.toEqual({ status: 'WAITING', migrationId: 'migration-1' });
    expect(db.nodeUpdateMany).not.toHaveBeenCalled();
    expect(db.projectionDeleteMany).not.toHaveBeenCalled();
  });

  it('releases source-only capacity and old exit only after remote confirmation', async () => {
    const useCase = new ProcessMigrationCleanupUseCase();

    await expect(useCase.execute('migration-1')).resolves.toEqual({ status: 'COMPLETED', migrationId: 'migration-1', migrationStatus: 'COMPLETED' });
    expect(db.nodeUpdateMany).toHaveBeenCalledWith({ where: { id: 'node-old', allocatedUnits: { gt: 0 } }, data: { allocatedUnits: { decrement: 1 } } });
    expect(db.exitUpdateMany).toHaveBeenCalledWith({ where: { id: 'exit-old', status: 'ASSIGNED' }, data: { status: 'RELEASED' } });
    expect(db.projectionDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ['source-projection'] } } });
    expect(db.lineUpdateMany).toHaveBeenCalledWith({ where: { id: 'line-1', activeMigrationId: 'migration-1' }, data: { activeMigrationId: null } });
    expect(db.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'dedicated_line.migration.cleanup', targetId: 'migration-1', actorType: 'SYSTEM',
    }) });
  });

  it('keeps retained source capacity allocated', async () => {
    db.migrationFindUnique.mockResolvedValueOnce({
      ...(await db.migrationFindUnique()),
      nodes: [
        { id: 'source-node', nodeId: 'node-shared', role: 'SOURCE', reservationStatus: 'RELEASED', projectionId: 'source-projection' },
        { id: 'target-node', nodeId: 'node-shared', role: 'TARGET', reservationStatus: 'RELEASED', projectionId: 'target-projection' },
      ],
    });
    const useCase = new ProcessMigrationCleanupUseCase();

    await expect(useCase.execute('migration-1')).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(db.nodeUpdateMany).not.toHaveBeenCalled();
  });

  it('releases staged target resources after cancellation only after remote confirmation', async () => {
    db.migrationFindUnique.mockResolvedValueOnce({
      ...(await db.migrationFindUnique()),
      status: 'CANCELLED', committedAt: null,
      nodes: [{ id: 'target-node', nodeId: 'node-new', role: 'TARGET', reservationStatus: 'RESERVED', reservedUnits: 1, projectionId: 'target-projection' }],
    });
    db.jobFindMany.mockResolvedValueOnce([{ aggregateId: 'target-projection', status: 'COMPLETED' }]);
    const useCase = new ProcessMigrationCleanupUseCase();

    await expect(useCase.execute('migration-1')).resolves.toEqual({ status: 'COMPLETED', migrationId: 'migration-1', migrationStatus: 'CANCELLED' });
    expect(db.nodeUpdateMany).toHaveBeenCalledWith({ where: { id: 'node-new', allocatedUnits: { gt: 0 } }, data: { allocatedUnits: { decrement: 1 } } });
    expect(db.exitUpdateMany).toHaveBeenCalledWith({ where: { id: 'exit-new', status: 'RESERVED' }, data: { status: 'AVAILABLE' } });
    expect(db.projectionDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ['target-projection'] } } });
  });

  it.each([
    ['COMPLETED', 'COMPLETED'],
    ['CANCELLED', 'CANCELLED'],
  ] as const)('replays terminal %s cleanup without releasing resources again', async (status, expected) => {
    db.migrationFindUnique.mockResolvedValueOnce({
      ...(await db.migrationFindUnique()),
      status,
      finishedAt: new Date(),
    });
    const useCase = new ProcessMigrationCleanupUseCase();

    await expect(useCase.execute('migration-1')).resolves.toEqual({ status: 'COMPLETED', migrationId: 'migration-1', migrationStatus: expected });
    expect(db.nodeUpdateMany).not.toHaveBeenCalled();
    expect(db.exitUpdateMany).not.toHaveBeenCalled();
    expect(db.projectionDeleteMany).not.toHaveBeenCalled();
  });
});
