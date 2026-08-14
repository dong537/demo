import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeDeliveryRouteImport } from './delivery-route-import.domain';
const db = vi.hoisted(() => { const findUnique = vi.fn(); const findFirst = vi.fn(); const create = vi.fn(); const updateMany = vi.fn(); const lineUpdate = vi.fn(); const migrationUpdate = vi.fn(); const auditCreate = vi.fn(); const transaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback({ delivery_route_imports: { findUnique, create }, dedicated_line_migrations: { findFirst, update: migrationUpdate }, dedicated_lines: { findFirst, update: lineUpdate }, delivery_routes: { updateMany, create: vi.fn() }, audit_logs: { create: auditCreate } })); return { findUnique, findFirst, create, updateMany, lineUpdate, migrationUpdate, auditCreate, transaction }; });
vi.mock('@ipeasy/db', () => ({ prisma: { $transaction: db.transaction } }));
import { DeliveryRouteImportUseCase } from './delivery-route-import.use-case';
const ctx = { ownerId: 'admin-1', ownerType: 'PLATFORM_ADMIN' as const, siteId: 'site-1', tenantId: null, scopes: [], requestId: 'req-1' };
const base = { sourceName: 'ny', sourceVersion: 'v1', capturedAt: '2026-08-11T00:00:00.000Z', routes: [{ sourceRouteId: 'r1', dedicatedLineId: 'line-1', entranceGroupCode: 'SV', protocol: 'VLESS', listenPort: 60701, sourceVersion: 'v1', validFrom: '2026-08-11T00:00:00.000Z', domains: [{ hostname: 'backup.example.com', port: 60701, isPrimary: false }], targets: [{ nodeId: 'node-target', targetPort: 60701, targetVersion: 'v2' }] }] };
beforeEach(() => { vi.clearAllMocks(); db.findUnique.mockResolvedValue(null); db.findFirst.mockImplementation((args: { where?: { id?: string } }) => args.where?.id === 'migration-1' ? { id: 'migration-1', dedicatedLineId: 'line-1', sourceLineVersion: 1, targetLineVersion: 2, phase: 'CANARY_ROUTE', status: 'ACTIVE', type: 'FULL', nodes: [{ nodeId: 'node-target', role: 'TARGET', projectionId: 'p1' }] } : { id: 'line-1', protocol: 'VLESS', inboundProfile: { listenPort: 60701 }, placement: { nodes: [{ nodeId: 'node-target' }] }, domains: [{ hostname: 'backup.example.com', port: 60701, role: 'BACKUP' }], projections: [{ id: 'p1', nodeId: 'node-target', status: 'READY', desiredVersion: 2, observedVersion: 2, nodeExternalId: 'v2', migrationId: 'migration-1' }], status: 'MIGRATING_AWAITING_ROUTE_IMPORT' }); db.create.mockResolvedValue({ id: 'import-1' }); });
describe('DeliveryRouteImportUseCase staged routes', () => {
  it('does not change current route for CANARY', async () => {
    await expect(new DeliveryRouteImportUseCase().execute(ctx, { ...base, stage: 'CANARY', migrationId: 'migration-1' })).resolves.toMatchObject({ stage: 'CANARY', currentChanged: false });
    expect(db.updateMany).not.toHaveBeenCalled();
    expect(db.migrationUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ phase: 'VERIFY' }) }));
    expect(db.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'dedicated_line.route_import', targetId: 'import-1', requestId: 'req-1',
    }) });
  });

  it('rejects replaying an import under a different migration stage', async () => {
    db.findUnique.mockResolvedValueOnce({
      id: 'import-existing',
      sourceFingerprint: normalizeDeliveryRouteImport({ ...base, allowCanaryDomains: true }).sourceFingerprint,
      sourceName: base.sourceName,
      sourceVersion: base.sourceVersion,
      routes: [{ id: 'route-existing', migrationId: 'migration-1', migrationStage: 'CUTOVER' }],
    });
    const normalizedFingerprint = await new DeliveryRouteImportUseCase().execute(ctx, {
      ...base,
      stage: 'CANARY',
      migrationId: 'migration-1',
    }).catch((error: unknown) => error);

    expect(normalizedFingerprint).toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      reasonKey: 'route_import_replay_contract_conflict',
    });
  });

  it('ignores the retained-node source projection when the migration target projection is ready', async () => {
    db.findFirst.mockImplementation((args: { where?: { id?: string } }) => args.where?.id === 'migration-1'
      ? { id: 'migration-1', dedicatedLineId: 'line-1', sourceLineVersion: 1, targetLineVersion: 2, phase: 'CANARY_ROUTE', status: 'ACTIVE', type: 'FULL', nodes: [{ nodeId: 'node-target', role: 'TARGET', projectionId: 'p-target' }] }
      : {
          id: 'line-1', protocol: 'VLESS', inboundProfile: { listenPort: 60701 },
          placement: { nodes: [{ nodeId: 'node-target' }] },
          domains: [{ hostname: 'backup.example.com', port: 60701, role: 'BACKUP' }],
          projections: [
            { id: 'p-source', nodeId: 'node-target', status: 'READY', desiredVersion: 1, observedVersion: 1, nodeExternalId: 'v1', migrationId: null },
            { id: 'p-target', nodeId: 'node-target', status: 'READY', desiredVersion: 2, observedVersion: 2, nodeExternalId: 'v2', migrationId: 'migration-1' },
          ],
          status: 'MIGRATING_AWAITING_ROUTE_IMPORT',
        });

    await expect(new DeliveryRouteImportUseCase().execute(ctx, { ...base, stage: 'CANARY', migrationId: 'migration-1' })).resolves.toMatchObject({ stage: 'CANARY' });
  });

  it('rejects route evidence for a different dedicated line', async () => {
    const wrongLine = { ...base, routes: [{ ...base.routes[0], dedicatedLineId: 'line-other' }] };
    await expect(new DeliveryRouteImportUseCase().execute(ctx, { ...wrongLine, stage: 'CANARY', migrationId: 'migration-1' })).rejects.toMatchObject({
      reasonKey: 'migration_route_line_mismatch',
    });
  });

  it('requires staged route targets to cover every migration target node', async () => {
    db.findFirst.mockImplementation((args: { where?: { id?: string } }) => args.where?.id === 'migration-1'
      ? { id: 'migration-1', dedicatedLineId: 'line-1', sourceLineVersion: 1, targetLineVersion: 2, phase: 'CANARY_ROUTE', status: 'ACTIVE', type: 'FULL', nodes: [
          { nodeId: 'node-target', role: 'TARGET', projectionId: 'p1' },
          { nodeId: 'node-second', role: 'TARGET', projectionId: 'p2' },
        ] }
      : { id: 'line-1', protocol: 'VLESS', inboundProfile: { listenPort: 60701 }, placement: { nodes: [{ nodeId: 'node-target' }] }, domains: [{ hostname: 'backup.example.com', port: 60701, role: 'BACKUP' }], projections: [
          { id: 'p1', nodeId: 'node-target', status: 'READY', desiredVersion: 2, observedVersion: 2, nodeExternalId: 'v2', migrationId: 'migration-1' },
          { id: 'p2', nodeId: 'node-second', status: 'READY', desiredVersion: 2, observedVersion: 2, nodeExternalId: 'v2-second', migrationId: 'migration-1' },
        ], status: 'MIGRATING_AWAITING_ROUTE_IMPORT' });

    await expect(new DeliveryRouteImportUseCase().execute(ctx, { ...base, stage: 'CANARY', migrationId: 'migration-1' })).rejects.toMatchObject({
      reasonKey: 'route_import_target_set_mismatch',
    });
  });

  it('requires each target version to match the observed remote projection identity', async () => {
    const stale = { ...base, routes: [{ ...base.routes[0], targets: [{ ...base.routes[0].targets[0], targetVersion: 'v1' }] }] };
    await expect(new DeliveryRouteImportUseCase().execute(ctx, { ...stale, stage: 'CANARY', migrationId: 'migration-1' })).rejects.toMatchObject({
      reasonKey: 'route_import_target_version_mismatch',
    });
  });

  it('requires rollback targets to have matching ready source projections', async () => {
    db.findFirst.mockImplementation((args: { where?: { id?: string } }) => args.where?.id === 'migration-1'
      ? { id: 'migration-1', dedicatedLineId: 'line-1', sourceLineVersion: 1, targetLineVersion: 2, phase: 'ROLLBACK', status: 'NEEDS_OPERATOR', type: 'FULL', nodes: [{ nodeId: 'node-source', role: 'SOURCE', projectionId: null }] }
      : { id: 'line-1', protocol: 'VLESS', inboundProfile: { listenPort: 60701 }, placement: { nodes: [{ nodeId: 'node-source' }] }, domains: [{ hostname: 'primary.example.com', port: 60701, role: 'PRIMARY' }], projections: [], status: 'ACTIVE' });
    const rollback = { ...base, routes: [{ ...base.routes[0], domains: [{ hostname: 'primary.example.com', port: 60701, isPrimary: true }], targets: [{ nodeId: 'node-source', targetPort: 60701, targetVersion: 'v1' }] }] };

    await expect(new DeliveryRouteImportUseCase().execute(ctx, { ...rollback, stage: 'ROLLBACK', migrationId: 'migration-1' })).rejects.toMatchObject({
      reasonKey: 'route_import_source_projection_not_ready',
    });
  });
});
