import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticatedContext } from '../../common/auth/auth-context';

const db = vi.hoisted(() => {
  const findFirst = vi.fn(); const operationFindUnique = vi.fn(); const domainFindMany = vi.fn(); const domainUpdateMany = vi.fn(); const domainCreateMany = vi.fn(); const operationCreate = vi.fn(); const auditCreate = vi.fn();
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback({ dedicated_lines: { findFirst }, dedicated_line_domain_binding_operations: { findUnique: operationFindUnique, create: operationCreate }, dedicated_line_domains: { findMany: domainFindMany, updateMany: domainUpdateMany, createMany: domainCreateMany }, audit_logs: { create: auditCreate } }));
  return { findFirst, operationFindUnique, domainFindMany, domainUpdateMany, domainCreateMany, operationCreate, auditCreate, transaction };
});
vi.mock('@ipeasy/db', () => ({ prisma: { $transaction: db.transaction } }));
import { LineDomainBindingsUseCase } from './line-domain-bindings.use-case';

const ctx: AuthenticatedContext = { ownerId: 'admin-1', ownerType: 'PLATFORM_ADMIN', siteId: 'site-1', tenantId: null, scopes: [], requestId: 'req-1' };
const domains = [{ hostname: 'main.example.com', port: 60701, role: 'PRIMARY' }, { hostname: 'backup.example.com', port: 60701, role: 'BACKUP' }];
beforeEach(() => { vi.clearAllMocks(); db.findFirst.mockResolvedValue({ id: 'line-1', tenantId: 'tenant-1', userId: 'user-1' }); db.operationFindUnique.mockResolvedValue(null); db.domainFindMany.mockResolvedValue([]); db.operationCreate.mockResolvedValue({}); });

describe('LineDomainBindingsUseCase', () => {
  it('requires one primary and one backup', async () => { await expect(new LineDomainBindingsUseCase().execute(ctx, 'line-1', { domains: [domains[0]], reason: 'bind', idempotencyKey: 'k1' })).rejects.toMatchObject({ reasonKey: 'line_backup_domain_required' }); });
  it('retires old domains, creates new bindings, and audits in one transaction', async () => { const result = await new LineDomainBindingsUseCase().execute(ctx, 'line-1', { domains, reason: 'bind', idempotencyKey: 'k1' }) as { domains: typeof domains }; expect(db.domainUpdateMany).toHaveBeenCalled(); expect(db.domainCreateMany).toHaveBeenCalledWith({ data: expect.arrayContaining([expect.objectContaining({ hostname: 'main.example.com', role: 'PRIMARY' })]) }); expect(db.auditCreate).toHaveBeenCalled(); expect(result.domains).toEqual(domains); });
  it('replays an idempotent operation without writing domains again', async () => { db.operationFindUnique.mockResolvedValue({ result: { lineId: 'line-1', domains } }); await expect(new LineDomainBindingsUseCase().execute(ctx, 'line-1', { domains, reason: 'bind', idempotencyKey: 'k1' })).resolves.toEqual({ lineId: 'line-1', domains }); expect(db.domainCreateMany).not.toHaveBeenCalled(); });
});
