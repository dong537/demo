import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuthenticatedContext } from '../../common/auth/auth-context';

const db = vi.hoisted(() => {
  const migrationFindFirst = vi.fn();
  const migrationUpdateMany = vi.fn();
  const projectionFindMany = vi.fn();
  const projectionDeleteMany = vi.fn();
  const jobDeleteMany = vi.fn();
  const jobCreate = vi.fn();
  const nodeUpdateMany = vi.fn();
  const migrationNodeUpdateMany = vi.fn();
  const exitUpdateMany = vi.fn();
  const lineUpdate = vi.fn();
  const auditCreate = vi.fn();
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback({
    dedicated_line_migrations: { findFirst: migrationFindFirst, updateMany: migrationUpdateMany },
    dedicated_line_projections: { findMany: projectionFindMany, deleteMany: projectionDeleteMany },
    external_jobs: { deleteMany: jobDeleteMany, create: jobCreate },
    control_nodes: { updateMany: nodeUpdateMany },
    dedicated_line_migration_nodes: { updateMany: migrationNodeUpdateMany },
    residential_exits: { updateMany: exitUpdateMany },
    dedicated_lines: { update: lineUpdate },
    audit_logs: { create: auditCreate },
  }));
  return { migrationFindFirst, migrationUpdateMany, projectionFindMany, projectionDeleteMany, jobDeleteMany, jobCreate, nodeUpdateMany, migrationNodeUpdateMany, exitUpdateMany, lineUpdate, auditCreate, transaction };
});

vi.mock('@ipeasy/db', () => ({ prisma: { $transaction: db.transaction } }));

import { CancelDedicatedLineMigrationUseCase } from './cancel-migration.use-case';

const ctx: AuthenticatedContext = { ownerId: 'admin-1', ownerType: 'PLATFORM_ADMIN', siteId: 'site-1', tenantId: null, scopes: [], requestId: 'req-1' };

beforeEach(() => {
  vi.clearAllMocks();
  db.migrationUpdateMany.mockResolvedValue({ count: 1 });
  db.migrationFindFirst.mockResolvedValue({
    id: 'migration-1', siteId: 'site-1', tenantId: 'tenant-1', userId: 'user-1', dedicatedLineId: 'line-1',
    targetLineVersion: 2, targetExitId: 'exit-new', type: 'FULL', phase: 'PREPARE', status: 'ACTIVE',
    nodes: [{ id: 'target-node', nodeId: 'node-new', role: 'TARGET', reservationStatus: 'RESERVED', projectionId: 'target-projection' }],
  });
  db.projectionFindMany.mockResolvedValue([{ id: 'target-projection', nodeId: 'node-new', projectionKey: 'line-1:node-new:v2', desiredVersion: 2 }]);
});

describe('CancelDedicatedLineMigrationUseCase', () => {
  it('queues staged remote deletion before releasing local resources', async () => {
    const useCase = new CancelDedicatedLineMigrationUseCase();

    await expect(useCase.execute(ctx, 'migration-1')).resolves.toEqual({ migrationId: 'migration-1', phase: 'CLEANUP', status: 'CANCELLED' });

    expect(db.nodeUpdateMany).not.toHaveBeenCalled();
    expect(db.migrationNodeUpdateMany).not.toHaveBeenCalled();
    expect(db.exitUpdateMany).not.toHaveBeenCalled();
    expect(db.projectionDeleteMany).not.toHaveBeenCalled();
    expect(db.lineUpdate).not.toHaveBeenCalled();
    expect(db.jobCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      kind: 'DELETE_DEDICATED_LINE_PROJECTION', aggregateId: 'target-projection', desiredVersion: 3,
    }) }));
    expect(db.jobCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      kind: 'CLEANUP_DEDICATED_LINE_MIGRATION', aggregateId: 'migration-1',
    }) }));
    expect(db.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'dedicated_line.migration.cancel', targetId: 'migration-1', requestId: 'req-1',
    }) });
  });

  it('rejects a cancellation raced by another migration transition', async () => {
    db.migrationUpdateMany.mockResolvedValueOnce({ count: 0 });
    const useCase = new CancelDedicatedLineMigrationUseCase();

    await expect(useCase.execute(ctx, 'migration-1')).rejects.toMatchObject({
      reasonKey: 'migration_cancel_raced',
    });
    expect(db.auditCreate).not.toHaveBeenCalled();
  });
});
