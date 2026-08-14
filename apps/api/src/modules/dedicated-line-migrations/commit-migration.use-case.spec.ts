import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptAesGcm } from '../../common/crypto/aes-gcm';
import { type AuthenticatedContext } from '../../common/auth/auth-context';

const db = vi.hoisted(() => {
  const migrationFindFirst = vi.fn();
  const projectionFindMany = vi.fn();
  const projectionUpdate = vi.fn();
  const projectionDeleteMany = vi.fn();
  const placementUpdate = vi.fn();
  const nodeUpdateMany = vi.fn();
  const migrationNodeUpdate = vi.fn();
  const exitAssignmentUpdate = vi.fn();
  const exitUpdate = vi.fn();
  const routeFindMany = vi.fn();
  const routeUpdateMany = vi.fn();
  const externalJobCreate = vi.fn();
  const externalJobDeleteMany = vi.fn();
  const lineUpdate = vi.fn();
  const migrationUpdate = vi.fn();
  const auditCreate = vi.fn();
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback({
    dedicated_line_migrations: { findFirst: migrationFindFirst, update: migrationUpdate },
    dedicated_line_projections: { findMany: projectionFindMany, update: projectionUpdate, deleteMany: projectionDeleteMany },
    dedicated_line_placements: { update: placementUpdate },
    dedicated_line_migration_nodes: { update: migrationNodeUpdate },
    control_nodes: { updateMany: nodeUpdateMany },
    dedicated_line_exit_assignments: { update: exitAssignmentUpdate },
    residential_exits: { update: exitUpdate },
    delivery_routes: { findMany: routeFindMany, updateMany: routeUpdateMany },
    external_jobs: { create: externalJobCreate, deleteMany: externalJobDeleteMany },
    dedicated_lines: { update: lineUpdate },
    audit_logs: { create: auditCreate },
  }));
  return {
    migrationFindFirst, projectionFindMany, projectionUpdate, projectionDeleteMany, placementUpdate,
    nodeUpdateMany, migrationNodeUpdate, exitAssignmentUpdate, exitUpdate, routeFindMany, routeUpdateMany,
    externalJobCreate, externalJobDeleteMany, lineUpdate, migrationUpdate, auditCreate, transaction,
  };
});

vi.mock('@ipeasy/db', () => ({ prisma: { $transaction: db.transaction } }));

import { CommitDedicatedLineMigrationUseCase } from './commit-migration.use-case';

const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ctx: AuthenticatedContext = { ownerId: 'admin-1', ownerType: 'PLATFORM_ADMIN', siteId: 'site-1', tenantId: null, scopes: [], requestId: 'req-1' };

beforeEach(() => {
  vi.clearAllMocks();
  db.migrationFindFirst.mockResolvedValue(migrationFixture());
  db.projectionFindMany
    .mockResolvedValueOnce([{ id: 'target-projection', nodeId: 'node-new', status: 'READY', desiredVersion: 2, observedVersion: 2, projectionKey: 'line-1:node-new:v2' }])
    .mockResolvedValueOnce([{ id: 'source-projection', nodeId: 'node-old', status: 'READY', desiredVersion: 1, observedVersion: 1, projectionKey: 'line-1:node-old' }]);
  db.routeFindMany.mockResolvedValue([{ id: 'cutover-route' }]);
});

describe('CommitDedicatedLineMigrationUseCase', () => {
  it('refuses commit when the staged target projection set is incomplete', async () => {
    db.projectionFindMany.mockReset().mockResolvedValueOnce([]);
    const useCase = new CommitDedicatedLineMigrationUseCase({ get: () => key } as never);

    await expect(useCase.execute(ctx, 'migration-1')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'migration_target_projection_not_ready',
    });
    expect(db.lineUpdate).not.toHaveBeenCalled();
    expect(db.externalJobCreate).not.toHaveBeenCalled();
  });

  it('keeps old resources until remote cleanup and leaves the line provisioning', async () => {
    const useCase = new CommitDedicatedLineMigrationUseCase({ get: () => key } as never);

    await expect(useCase.execute(ctx, 'migration-1')).resolves.toEqual({ migrationId: 'migration-1', phase: 'CLEANUP', status: 'ACTIVE' });

    expect(db.nodeUpdateMany).not.toHaveBeenCalled();
    expect(db.projectionDeleteMany).not.toHaveBeenCalled();
    expect(db.exitUpdate).not.toHaveBeenCalledWith({ where: { id: 'exit-old' }, data: { status: 'RELEASED' } });
    expect(db.lineUpdate).toHaveBeenCalledWith({
      where: { id: 'line-1' },
      data: { desiredVersion: 2, activeMigrationId: 'migration-1', status: 'PROVISIONING' },
    });
    expect(db.projectionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'target-projection' },
      data: expect.objectContaining({ status: 'PENDING' }),
    }));
    expect(db.projectionUpdate.mock.calls[0]?.[0]?.data).not.toHaveProperty('projectionKey');
    expect(db.externalJobCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      kind: 'APPLY_DEDICATED_LINE_PROJECTION', payload: expect.objectContaining({ projectionKey: 'line-1:node-new:v2' }),
    }) }));
    expect(db.externalJobCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      kind: 'DELETE_DEDICATED_LINE_PROJECTION', aggregateId: 'source-projection', desiredVersion: 2,
    }) }));
    expect(db.externalJobCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      kind: 'CLEANUP_DEDICATED_LINE_MIGRATION', aggregateId: 'migration-1',
    }) }));
  });

  it('refuses commit when the current source projection set is incomplete', async () => {
    db.projectionFindMany.mockReset()
      .mockResolvedValueOnce([{ id: 'target-projection', nodeId: 'node-new', status: 'READY', desiredVersion: 2, observedVersion: 2, projectionKey: 'line-1:node-new:v2' }])
      .mockResolvedValueOnce([]);
    const useCase = new CommitDedicatedLineMigrationUseCase({ get: () => key } as never);

    await expect(useCase.execute(ctx, 'migration-1')).rejects.toMatchObject({
      reasonKey: 'migration_source_projection_not_ready',
    });
    expect(db.placementUpdate).not.toHaveBeenCalled();
    expect(db.lineUpdate).not.toHaveBeenCalled();
    expect(db.externalJobCreate).not.toHaveBeenCalled();
  });

  it('refuses commit when no staged cutover route belongs to the migration', async () => {
    db.routeFindMany.mockResolvedValueOnce([]);
    const useCase = new CommitDedicatedLineMigrationUseCase({ get: () => key } as never);

    await expect(useCase.execute(ctx, 'migration-1')).rejects.toMatchObject({ reasonKey: 'migration_cutover_route_missing' });
    expect(db.lineUpdate).not.toHaveBeenCalled();
  });
});

function migrationFixture() {
  return {
    id: 'migration-1', siteId: 'site-1', tenantId: 'tenant-1', userId: 'user-1', dedicatedLineId: 'line-1',
    type: 'FULL', phase: 'COMMIT', status: 'ACTIVE', reason: 'move', sourceLineVersion: 1, targetLineVersion: 2,
    sourceExitId: 'exit-old', targetExitId: 'exit-new', committedAt: null, cutoverRouteImport: { id: 'route-import' },
    targetExit: {
      id: 'exit-new', endpointCiphertext: encryptAesGcm(JSON.stringify({ host: '203.0.113.9', port: 1080 }), key),
      credentialCiphertext: encryptAesGcm(JSON.stringify({ username: 'u', password: 'p' }), key),
    },
    dedicatedLine: {
      id: 'line-1', tenantId: 'tenant-1', userId: 'user-1', desiredVersion: 1, protocol: 'VLESS',
      clientEmail: 'line@example.com', clientIdentityCiphertext: encryptAesGcm(JSON.stringify({ id: 'client-1' }), key),
      status: 'ACTIVE', expiresAt: null, quotaBytes: null, uplinkLimitBps: null, downlinkLimitBps: null,
      maxConnections: null, ipLimit: null, inboundProfile: { inboundTag: 'sv' },
      placement: { id: 'placement-1', nodes: [{ nodeId: 'node-old' }] },
      exitAssignment: { id: 'assignment-1', residentialExitId: 'exit-old', residentialExit: { id: 'exit-old' } },
    },
    nodes: [
      { id: 'source-node', nodeId: 'node-old', role: 'SOURCE', projectionId: null, reservationStatus: 'RELEASED' },
      { id: 'target-node', nodeId: 'node-new', role: 'TARGET', projectionId: 'target-projection', reservationStatus: 'RESERVED' },
    ],
    smokeObservations: [{ verified: true, freshUntil: new Date(Date.now() + 60_000) }],
  };
}
