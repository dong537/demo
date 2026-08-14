import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@ipeasy/db';
import { cleanDatabase, seedSite, seedTenant, seedUser } from '../../../test-utils/integration-setup';
import { PricingRepository } from '../pricing.repository';

describe('PricingRepository integration', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  it('does not reactivate a hidden resource when an admin sets its global sale price', async () => {
    const siteId = await seedSite();
    const resource = await prisma.platform_resources.create({
      data: {
        siteId,
        type: 'COUNTRY',
        code: 'SG',
        name: 'Singapore',
        providerCode: 'PR',
        ipType: 'NATIVE',
        protocol: 'BOTH',
        status: 'HIDDEN',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: 'not_configured',
      },
    });
    const repo = new PricingRepository();

    const override = await repo.upsertOverride({
      siteId,
      resourceId: resource.id,
      durationDays: 30,
      unitPrice: '41.00',
      currency: 'CNY',
    });

    expect(override.unitPrice.toString()).toBe('41');
    const updated = await prisma.platform_resources.findUniqueOrThrow({ where: { id: resource.id } });
    expect(updated).toMatchObject({
      status: 'HIDDEN',
      isVisible: false,
      isSaleable: false,
      unsaleableReason: 'not_configured',
    });
  });

  it('restores an active visible resource that was blocked only because price was missing', async () => {
    const siteId = await seedSite();
    const resource = await prisma.platform_resources.create({
      data: {
        siteId,
        type: 'COUNTRY',
        code: 'JP',
        name: 'Japan',
        providerCode: 'IPIPD',
        ipType: 'NATIVE',
        protocol: 'BOTH',
        status: 'ACTIVE',
        isVisible: true,
        isSaleable: false,
        unsaleableReason: 'price_missing',
      },
    });
    const repo = new PricingRepository();

    await repo.upsertOverride({
      siteId,
      resourceId: resource.id,
      durationDays: 30,
      unitPrice: '39.00',
      currency: 'CNY',
    });

    const updated = await prisma.platform_resources.findUniqueOrThrow({ where: { id: resource.id } });
    expect(updated).toMatchObject({
      status: 'ACTIVE',
      isVisible: true,
      isSaleable: true,
      unsaleableReason: null,
    });
  });

  it('uses a same-country global override when a concrete line has no direct price', async () => {
    const siteId = await seedSite();
    const tenantId = await seedTenant(siteId);
    const { userId } = await seedUser(siteId, tenantId, {
      email: 'country-price-fallback@example.com',
      password: 'password',
    });
    const countryResource = await prisma.platform_resources.create({
      data: {
        siteId,
        type: 'COUNTRY',
        code: 'UA',
        name: 'Ukraine',
        providerCode: 'PR',
        ipType: 'NATIVE',
        protocol: 'BOTH',
        status: 'ACTIVE',
        isVisible: true,
        isSaleable: true,
      },
    });
    const lineResource = await prisma.platform_resources.create({
      data: {
        siteId,
        type: 'REGION',
        code: 'UA:6928:Kyiv:Provider',
        name: 'Ukraine-Kyiv-Provider',
        providerCode: 'PR',
        ipType: 'NATIVE',
        protocol: 'BOTH',
        status: 'ACTIVE',
        isVisible: true,
        isSaleable: true,
      },
    });
    const repo = new PricingRepository();
    await repo.upsertOverride({
      siteId,
      resourceId: countryResource.id,
      durationDays: 30,
      unitPrice: '10.00',
      currency: 'CNY',
    });

    const price = await repo.getPriceForUser(siteId, userId, lineResource.id, 30, 1, 'CNY');

    expect(price).toEqual({
      unitPrice: '10',
      currency: 'CNY',
      source: 'RESOURCE_OVERRIDE',
    });
  });

  it('uses a parent region global override before the country override', async () => {
    const siteId = await seedSite();
    const tenantId = await seedTenant(siteId);
    const { userId } = await seedUser(siteId, tenantId, {
      email: 'parent-region-price-fallback@example.com',
      password: 'password',
    });
    const countryResource = await prisma.platform_resources.create({
      data: {
        siteId,
        type: 'COUNTRY',
        code: 'UA',
        name: 'Ukraine',
        providerCode: 'PR',
        ipType: 'NATIVE',
        protocol: 'BOTH',
        status: 'ACTIVE',
        isVisible: true,
        isSaleable: true,
      },
    });
    const regionResource = await prisma.platform_resources.create({
      data: {
        siteId,
        parentId: countryResource.id,
        type: 'REGION',
        code: 'UA:6928:Kyiv:Provider',
        name: 'Ukraine-Kyiv-Provider',
        providerCode: 'PR',
        ipType: 'NATIVE',
        protocol: 'BOTH',
        status: 'ACTIVE',
        isVisible: true,
        isSaleable: true,
      },
    });
    const networkResource = await prisma.platform_resources.create({
      data: {
        siteId,
        parentId: regionResource.id,
        type: 'ZONE',
        code: 'UA:6928:Kyiv:Provider:Subnet',
        name: 'Ukraine-Kyiv-Provider-Subnet',
        providerCode: 'PR',
        ipType: 'NATIVE',
        protocol: 'BOTH',
        status: 'ACTIVE',
        isVisible: true,
        isSaleable: true,
      },
    });
    const repo = new PricingRepository();
    await repo.upsertOverride({
      siteId,
      resourceId: countryResource.id,
      durationDays: 30,
      unitPrice: '10.00',
      currency: 'CNY',
    });
    await repo.upsertOverride({
      siteId,
      resourceId: regionResource.id,
      durationDays: 30,
      unitPrice: '22.00',
      currency: 'CNY',
    });

    const price = await repo.getPriceForUser(siteId, userId, networkResource.id, 30, 1, 'CNY');

    expect(price).toEqual({
      unitPrice: '22',
      currency: 'CNY',
      source: 'RESOURCE_OVERRIDE',
    });
  });
});
