import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@ipeasy/db/generated/client';
import { AuthenticatedContext } from '../../common/auth/auth-context';

const db = vi.hoisted(() => {
  const findUnique = vi.fn();
  const tenantFindFirst = vi.fn();
  const update = vi.fn();
  const auditCreate = vi.fn();
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback({
    sites: { findUnique, update },
    tenants: { findFirst: tenantFindFirst },
    audit_logs: { create: auditCreate },
  }));
  return { findUnique, tenantFindFirst, update, auditCreate, transaction };
});

vi.mock('@ipeasy/db', () => ({
  prisma: { $transaction: db.transaction },
}));

import { UpdateSiteDomainUseCase } from './update-site-domain.use-case';

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

beforeEach(() => {
  vi.clearAllMocks();
  db.findUnique.mockResolvedValue({ id: 'site-1', domain: 'old.example.com' });
  db.tenantFindFirst.mockResolvedValue(null);
  db.update.mockResolvedValue({ id: 'site-1', domain: 'new.example.com' });
});

describe('UpdateSiteDomainUseCase', () => {
  it('normalizes the domain and updates the site with an audit row in one transaction', async () => {
    const result = await new UpdateSiteDomainUseCase().execute(context(), { domain: ' New.Example.COM ' });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.tenantFindFirst).toHaveBeenCalledWith({
      where: { brandConfig: { path: ['customDomain'], equals: 'new.example.com' } },
      select: { id: true },
    });
    expect(db.update).toHaveBeenCalledWith({
      where: { id: 'site-1' },
      data: { domain: 'new.example.com' },
    });
    expect(db.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        siteId: 'site-1',
        tenantId: null,
        actorType: 'ADMIN_USER',
        actorId: 'admin-1',
        targetType: 'site',
        targetId: 'site-1',
        action: 'site.domain.update',
        requestId: 'request-1',
        meta: { previousDomain: 'old.example.com', newDomain: 'new.example.com' },
      }),
    });
    expect(result).toEqual({ id: 'site-1', domain: 'new.example.com' });
  });

  it('allows a SYSTEM operator and records a SYSTEM actor', async () => {
    await new UpdateSiteDomainUseCase().execute(
      context({ ownerId: 'deployment', ownerType: 'SYSTEM' }),
      { domain: 'new.example.com' },
    );

    expect(db.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorType: 'SYSTEM', actorId: 'deployment' }),
    });
  });

  it('rejects non-platform callers before opening a transaction', async () => {
    await expect(new UpdateSiteDomainUseCase().execute(
      context({ ownerType: 'TENANT_ADMIN', tenantId: 'tenant-1' }),
      { domain: 'new.example.com' },
    )).rejects.toMatchObject({ reasonKey: 'site_domain_admin_required', httpStatus: 403 });

    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('returns not found when the scoped site is absent', async () => {
    db.findUnique.mockResolvedValue(null);

    await expect(new UpdateSiteDomainUseCase().execute(context(), {
      domain: 'new.example.com',
    })).rejects.toMatchObject({ reasonKey: 'site_not_found', httpStatus: 404 });

    expect(db.update).not.toHaveBeenCalled();
    expect(db.auditCreate).not.toHaveBeenCalled();
  });

  it('maps a unique domain conflict to a stable API error', async () => {
    db.transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('conflict', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['domain'] },
    }));

    await expect(new UpdateSiteDomainUseCase().execute(context(), {
      domain: 'taken.example.com',
    })).rejects.toMatchObject({ reasonKey: 'site_domain_taken', httpStatus: 409 });
  });

  it('rejects a domain already assigned to a tenant brand', async () => {
    db.tenantFindFirst.mockResolvedValue({ id: 'tenant-1' });

    await expect(new UpdateSiteDomainUseCase().execute(context(), {
      domain: 'tenant.example.com',
    })).rejects.toMatchObject({ reasonKey: 'site_domain_taken', httpStatus: 409 });

    expect(db.update).not.toHaveBeenCalled();
    expect(db.auditCreate).not.toHaveBeenCalled();
  });
});
