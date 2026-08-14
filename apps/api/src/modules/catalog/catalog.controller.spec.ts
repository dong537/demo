import { describe, expect, it } from 'vitest';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { ErrorCode } from '../../common/errors/error-codes';
import { CatalogController } from './catalog.controller';
import { CatalogRepository } from './catalog.repository';
import { SkuQuoteUseCase } from './domain';

const SKU = {
  id: 'sku-sv',
  siteId: 'site-1',
  code: 'SV',
  name: 'Short Video Dedicated Line',
  description: null,
  isActive: true,
  isVisible: true,
  contractVersion: 1,
  capabilities: { delivery: 'dedicated-line' },
};

function context(overrides: Partial<AuthenticatedContext> = {}): AuthenticatedContext {
  return {
    ownerId: 'user-1',
    ownerType: 'USER',
    siteId: 'site-1',
    tenantId: 'tenant-1',
    scopes: [],
    requestId: 'request-1',
    ...overrides,
  };
}

function controller() {
  const repo = {
    listSkus: async (_siteId: string, includeInactive: boolean) => includeInactive
      ? [SKU, { ...SKU, id: 'sku-zb', code: 'ZB', isActive: false }]
      : [SKU],
    listSaleableSkusForBuyer: async () => [SKU],
  } as unknown as CatalogRepository;
  const quote = new SkuQuoteUseCase({
    assertBuyerScope: async () => undefined,
    findSku: async () => SKU,
    getPriceCandidates: async () => [{
      source: 'SITE_OVERRIDE',
      candidates: [{ unitPrice: '10', currency: 'CNY', source: 'SITE_OVERRIDE' }],
      hasCurrencyMismatch: true,
    }],
  });
  return new CatalogController(repo, quote);
}

describe('CatalogController', () => {
  it('returns only the customer-visible catalog for a user', async () => {
    const result = await controller().listCustomerSkus(context());

    expect(result).toEqual([expect.objectContaining({ id: 'sku-sv', code: 'SV' })]);
    expect(result[0]).not.toHaveProperty('siteId');
  });

  it('lets an admin read inactive SKU contracts but rejects customer access to the admin catalog', async () => {
    await expect(controller().listAdminSkus(context({
      ownerId: 'admin-1',
      ownerType: 'PLATFORM_ADMIN',
      tenantId: null,
    }))).resolves.toHaveLength(2);

    await expect(controller().listAdminSkus(context())).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
      reasonKey: 'insufficient_permissions',
    });
  });

  it('quotes a customer using only authenticated site, tenant and user scope', async () => {
    const result = await controller().quoteCustomer(context(), {
      skuCode: 'SV',
      durationDays: '30',
      quantity: '2',
      currency: 'CNY',
    });

    expect(result).toMatchObject({ skuCode: 'SV', totalPrice: '20' });
  });

  it('prevents a tenant admin from quoting a user in another tenant', async () => {
    expect(() => controller().quoteAdmin(context({
      ownerId: 'admin-1',
      ownerType: 'TENANT_ADMIN',
    }), {
      tenantId: 'tenant-2',
      userId: 'user-2',
      skuCode: 'SV',
      durationDays: '30',
      quantity: '1',
      currency: 'CNY',
    })).toThrowError(expect.objectContaining({
      code: ErrorCode.TENANT_SCOPE_VIOLATION,
      reasonKey: 'tenant_access_denied',
    }));
  });
});
