import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@ipeasy/db';
import {
  cleanDatabase,
  seedSite,
  seedTenant,
  seedUser,
} from '../../../test-utils/integration-setup';
import { DedicatedLineInventoryRepository } from '../dedicated-line-inventory.repository';
import { ReserveDedicatedLineStockUseCase } from '../domain';
import { WalletRepository } from '../../wallet/wallet.repository';

let repository: DedicatedLineInventoryRepository;
let useCase: ReserveDedicatedLineStockUseCase;

beforeAll(() => {
  repository = new DedicatedLineInventoryRepository(new WalletRepository());
  useCase = new ReserveDedicatedLineStockUseCase(repository);
});

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('dedicated-line inventory reservation', () => {
  it('atomically allows only one of two concurrent reservations and creates one provider job', async () => {
    const siteId = await seedSite();
    const tenantId = await seedTenant(siteId);
    const { userId } = await seedUser(siteId, tenantId, {
      email: 'line-reservation@example.com',
      password: 'unused',
    });
    await prisma.wallets.update({ where: { userId }, data: { available: '1' } });
    const account = await prisma.provider_accounts.create({
      data: {
        siteId,
        providerCode: 'NINE_EIGHT_FIVE',
        status: 'ACTIVE',
        credentialEncrypted: 'test-only',
        baseUrl: 'https://provider.invalid',
        inventorySyncEnabled: true,
      },
    });
    const sku = await prisma.service_skus.create({
      data: {
        siteId,
        code: 'SV',
        name: 'Short Video',
        capabilities: { delivery: 'dedicated-line' },
      },
    });
    const snapshot = await prisma.dedicated_line_inventory_snapshots.create({
      data: {
        siteId,
        providerAccountId: account.id,
        skuId: sku.id,
        providerCode: account.providerCode,
        countryCode: 'HK',
        providerResourceId: 'HK:premium',
        quantity: 1,
        sourceVersion: 'sync-1',
        capturedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const results = await Promise.allSettled([
      useCase.execute(request(siteId, tenantId, userId, account.id, sku.id, 'key-a')),
      useCase.execute(request(siteId, tenantId, userId, account.id, sku.id, 'key-b')),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await prisma.stock_reservations.count()).toBe(1);
    expect(await prisma.external_jobs.count({ where: { kind: 'PROVIDER_DEDICATED_LINE_ORDER' } })).toBe(1);
    expect(await prisma.outbox_events.count({ where: { topic: 'alerts.bark.inventory_low' } })).toBe(1);
    expect(await prisma.dedicated_line_inventory_snapshots.findUniqueOrThrow({ where: { id: snapshot.id } }))
      .toMatchObject({ quantity: 1, reservedQuantity: 1 });
  });

  it('replays the same reservation without creating a second provider job', async () => {
    const siteId = await seedSite();
    const tenantId = await seedTenant(siteId);
    const { userId } = await seedUser(siteId, tenantId, {
      email: 'line-replay@example.com',
      password: 'unused',
    });
    await prisma.wallets.update({ where: { userId }, data: { available: '1' } });
    const account = await prisma.provider_accounts.create({
      data: {
        siteId,
        providerCode: 'NINE_EIGHT_FIVE',
        status: 'ACTIVE',
        credentialEncrypted: 'test-only',
        baseUrl: 'https://provider.invalid',
        inventorySyncEnabled: true,
      },
    });
    const sku = await prisma.service_skus.create({
      data: { siteId, code: 'ZB', name: 'Live', capabilities: { delivery: 'dedicated-line' } },
    });
    await prisma.dedicated_line_inventory_snapshots.create({
      data: {
        siteId,
        providerAccountId: account.id,
        skuId: sku.id,
        providerCode: account.providerCode,
        countryCode: 'HK',
        providerResourceId: 'HK:premium',
        quantity: 2,
        sourceVersion: 'sync-2',
        capturedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const first = await useCase.execute(request(siteId, tenantId, userId, account.id, sku.id, 'same-key'));
    const second = await useCase.execute(request(siteId, tenantId, userId, account.id, sku.id, 'same-key'));

    expect(second).toMatchObject({
      reservationId: first.reservationId,
      jobId: first.jobId,
      replayed: true,
    });
    expect(await prisma.stock_reservations.count()).toBe(1);
    expect(await prisma.external_jobs.count()).toBe(1);
  });

  it('projects only explicitly mapped provider resources into the dedicated snapshot and route selector', async () => {
    const siteId = await seedSite();
    const tenantId = await seedTenant(siteId);
    const account = await prisma.provider_accounts.create({
      data: {
        siteId,
        providerCode: 'NINE_EIGHT_FIVE',
        tenantId,
        status: 'ACTIVE',
        credentialEncrypted: 'test-only',
        baseUrl: 'https://provider.invalid',
        inventorySyncEnabled: true,
      },
    });
    const sku = await prisma.service_skus.create({
      data: {
        siteId,
        code: 'SV',
        name: 'Short Video',
        capabilities: {
          delivery: 'dedicated-line',
          inventorySource: {
            providerCode: 'NINE_EIGHT_FIVE',
            providerResourceIds: ['HK:premium'],
          },
        },
      },
    });
    const capturedAt = new Date();

    const summary = await repository.syncProviderSnapshot({
      siteId,
      providerAccountId: account.id,
      providerCode: 'NINE_EIGHT_FIVE',
      capturedAt,
      items: [
        {
          countryCode: 'HK',
          countryName: 'Hong Kong',
          stock: 3,
          ipType: 'NATIVE',
          protocol: 'BOTH',
          providerResourceId: 'HK:premium',
        },
        {
          countryCode: 'US',
          countryName: 'United States',
          stock: 99,
          ipType: 'NATIVE',
          protocol: 'BOTH',
          providerResourceId: 'US:premium',
        },
      ],
    });

    expect(summary).toEqual({ snapshots: 1, mappedSkus: 1 });
    expect(await prisma.dedicated_line_inventory_snapshots.count()).toBe(1);
    await expect(repository.findFreshRoute({
      siteId,
      tenantId,
      skuId: sku.id,
      countryCode: 'HK',
    })).resolves.toEqual({
      providerCode: 'NINE_EIGHT_FIVE',
      providerAccountId: account.id,
      providerResourceId: 'HK:premium',
    });
  });
});

function request(
  siteId: string,
  tenantId: string,
  userId: string,
  providerAccountId: string,
  skuId: string,
  idempotencyKey: string,
) {
  return {
    siteId,
    tenantId,
    userId,
    providerCode: 'NINE_EIGHT_FIVE',
    providerAccountId,
    skuId,
    countryCode: 'HK',
    quantity: 1,
    idempotencyKey,
    orderSnapshot: {
      skuCode: 'SV',
      skuName: 'Dedicated Line',
      durationDays: 30,
      unitPrice: '1',
      totalPrice: '1',
      currency: 'CNY',
      priceSource: 'SITE_DEFAULT_TEMPLATE',
      contractVersion: 1,
    },
    charge: { amount: '1', currency: 'CNY', idempotencyKey: `debit-${idempotencyKey}` },
    jobPayload: { orderType: 'SV', durationDays: 30 },
  } as const;
}
