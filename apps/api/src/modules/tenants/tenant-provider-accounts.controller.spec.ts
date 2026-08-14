import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptAesGcm, encryptAesGcm } from '../../common/crypto/aes-gcm';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { TenantProviderAccountsController } from './tenant-provider-accounts.controller';
import { TenantProviderAccountItem, TenantProviderAccountsRepository } from './tenant-provider-accounts.repository';
import { TenantsRepository } from './tenants.repository';
import { ProvidersRepository } from '../providers/providers.repository';
import { SyncInventoryUseCase } from '../resources/use-cases/sync-inventory.use-case';

const auditCreate = vi.fn();
vi.mock('@ipeasy/db', () => ({
  prisma: {
    audit_logs: { create: (...args: unknown[]) => auditCreate(...args) },
  },
  Prisma: {},
}));

const ENC_KEY = 'a'.repeat(64);

function tenantAdminContext(overrides: Partial<AuthenticatedContext> = {}): AuthenticatedContext {
  return {
    ownerId: 'admin-1',
    ownerType: 'TENANT_ADMIN',
    siteId: 'site-1',
    tenantId: 'tenant-1',
    scopes: [],
    requestId: 'req-1',
    ...overrides,
  };
}

function providerAccount(overrides: Partial<TenantProviderAccountItem> = {}): TenantProviderAccountItem {
  const now = new Date('2026-06-26T00:00:00.000Z');
  return {
    id: 'pa-1',
    siteId: 'site-1',
    tenantId: 'tenant-1',
    providerCode: 'IPIPD',
    status: 'ACTIVE',
    credentialEncrypted: encryptAesGcm(JSON.stringify({ appId: 'old-app', appSecret: 'old-secret' }), ENC_KEY),
    baseUrl: 'https://api.ipipd.cn',
    timeoutMs: 15000,
    inventorySyncEnabled: true,
    enabledCountryCodes: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function build() {
  const tenantsRepo = {
    findById: vi.fn<TenantsRepository['findById']>().mockResolvedValue({ id: 'tenant-1', siteId: 'site-1' } as never),
  };
  const accountsRepo = {
    create: vi.fn<TenantProviderAccountsRepository['create']>(),
    findById: vi.fn<TenantProviderAccountsRepository['findById']>(),
    update: vi.fn<TenantProviderAccountsRepository['update']>(),
    disable: vi.fn<TenantProviderAccountsRepository['disable']>(),
    list: vi.fn<TenantProviderAccountsRepository['list']>(),
  };
  const providersRepo = {
    applyEnabledCountrySelectionToResources: vi.fn<ProvidersRepository['applyEnabledCountrySelectionToResources']>(),
    hideProviderAccountResources: vi.fn<ProvidersRepository['hideProviderAccountResources']>(),
  };
  const syncInventory = {
    execute: vi.fn<SyncInventoryUseCase['execute']>(),
  };
  const config = { get: vi.fn(() => ENC_KEY) };
  const controller = new TenantProviderAccountsController(
    tenantsRepo as unknown as TenantsRepository,
    accountsRepo as unknown as TenantProviderAccountsRepository,
    config as never,
    providersRepo as unknown as ProvidersRepository,
    syncInventory as unknown as SyncInventoryUseCase,
  );
  return { controller, accountsRepo, providersRepo, syncInventory };
}

beforeEach(() => {
  auditCreate.mockReset();
  auditCreate.mockResolvedValue(undefined);
});

describe('TenantProviderAccountsController', () => {
  it('merges partial credential edits with the existing encrypted credential', async () => {
    const { controller, accountsRepo, providersRepo } = build();
    const existing = providerAccount({
      providerCode: 'NINE_EIGHT_FIVE',
      credentialEncrypted: encryptAesGcm(JSON.stringify({ apikey: 'old-key', zoneId: 'old-zone' }), ENC_KEY),
    });
    accountsRepo.findById.mockResolvedValue(existing);
    accountsRepo.update.mockImplementation(async (_siteId, _tenantId, _accountId, data) => ({
      ...existing,
      ...data,
    }));
    providersRepo.hideProviderAccountResources.mockResolvedValue({ count: 1 });

    await controller.update(tenantAdminContext(), 'tenant-1', 'pa-1', {
      credential: { zoneId: 'new-zone' },
    });

    const encrypted = accountsRepo.update.mock.calls[0]?.[3].credentialEncrypted;
    expect(encrypted).toEqual(expect.any(String));
    expect(decryptAesGcm(encrypted!, ENC_KEY)).toBe(JSON.stringify({ apikey: 'old-key', zoneId: 'new-zone' }));
    expect(providersRepo.hideProviderAccountResources).toHaveBeenCalledWith(
      'site-1',
      'NINE_EIGHT_FIVE',
      'pa-1',
      'provider_config_changed',
    );
  });

  it('projects enabled country updates through the shared provider resource repository', async () => {
    const { controller, accountsRepo, providersRepo } = build();
    const existing = providerAccount();
    accountsRepo.findById.mockResolvedValue(existing);
    accountsRepo.update.mockImplementation(async (_siteId, _tenantId, _accountId, data) => ({
      ...existing,
      ...data,
    }));
    providersRepo.applyEnabledCountrySelectionToResources.mockResolvedValue({ updated: 4, saleable: 2, hidden: 2 });

    await controller.update(tenantAdminContext(), 'tenant-1', 'pa-1', {
      enabledCountryCodes: ['gb', 'JP'],
    });

    expect(providersRepo.applyEnabledCountrySelectionToResources).toHaveBeenCalledWith(
      'site-1',
      'IPIPD',
      ['GB', 'JP'],
      'pa-1',
    );
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        meta: expect.objectContaining({
          resourceSelection: { updated: 4, saleable: 2, hidden: 2 },
        }),
      }),
    }));
  });

  it('rejects incomplete provider-specific credentials on create', async () => {
    const { controller } = build();

    await expect(controller.create(tenantAdminContext(), 'tenant-1', {
      providerCode: 'IPIPD',
      credential: { appId: 'tenant-app' },
      baseUrl: 'https://api.ipipd.cn',
    })).rejects.toMatchObject({
      reasonKey: 'provider_credential_invalid',
      httpStatus: 400,
    });
  });

  it('syncs inventory for the exact tenant provider account after tenant access is verified', async () => {
    const { controller, accountsRepo, syncInventory } = build();
    accountsRepo.findById.mockResolvedValue(providerAccount({ providerCode: 'IPIPD' }));
    syncInventory.execute.mockResolvedValue({
      attempted: 1,
      created: 1,
      updated: 0,
      skipped: 0,
      failed: 0,
      synced: 1,
      syncedAt: new Date('2026-06-26T00:00:00.000Z'),
      upstreamRawStatus: 'SUCCESS',
      countries: ['GB'],
    });

    await expect(controller.syncInventoryHandler(tenantAdminContext(), 'tenant-1', 'pa-1')).resolves.toMatchObject({
      synced: 1,
      countries: ['GB'],
    });

    expect(accountsRepo.findById).toHaveBeenCalledWith('site-1', 'tenant-1', 'pa-1');
    expect(syncInventory.execute).toHaveBeenCalledWith('site-1', 'IPIPD', 'tenant-1', 'pa-1');
  });
});
