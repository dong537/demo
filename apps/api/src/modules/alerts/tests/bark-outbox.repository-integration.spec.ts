import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@ipeasy/db';
import { BarkAlertOutboxRepository } from '../bark-alert-outbox.repository';
import { cleanDatabase, seedSite } from '../../../test-utils/integration-setup';

describe('Bark alert outbox repository', () => {
  const repository = new BarkAlertOutboxRepository();
  let siteId = '';

  beforeEach(async () => {
    await cleanDatabase();
    siteId = await seedSite();
  });

  afterEach(async () => {
    await cleanDatabase();
  });

  it('claims and publishes an inventory alert exactly once for a worker lease', async () => {
    const event = await seedAlert(siteId);

    expect(await repository.findQueued(10)).toEqual([{ id: event.id }]);
    const claimed = await repository.claimRunnableEvent(event.id, 'worker-a');
    expect(claimed?.attempt).toBe(1);
    expect(await repository.claimRunnableEvent(event.id, 'worker-b')).toBeNull();

    await repository.markPublished(claimed!, 'worker-a');
    const persisted = await prisma.outbox_events.findUniqueOrThrow({ where: { id: event.id } });
    expect(persisted.status).toBe('PUBLISHED');
    expect(persisted.publishedAt).not.toBeNull();
    expect(persisted.leaseOwner).toBeNull();
  });

  it('moves an expired transmission lease to operator review instead of automatically duplicating a notification', async () => {
    const event = await seedAlert(siteId, {
      status: 'LEASED',
      attempt: 1,
      leaseOwner: 'lost-worker',
      leaseExpiresAt: new Date(Date.now() - 1_000),
    });

    expect(await repository.recoverExpiredLeases()).toBe(1);
    const persisted = await prisma.outbox_events.findUniqueOrThrow({ where: { id: event.id } });
    expect(persisted.status).toBe('NEEDS_OPERATOR');
    expect(persisted.lastErrorCode).toBe('BARK_DELIVERY_LEASE_EXPIRED');
  });
});

async function seedAlert(
  siteId: string,
  overrides: Partial<{ status: 'PENDING' | 'LEASED'; attempt: number; leaseOwner: string | null; leaseExpiresAt: Date | null }> = {},
) {
  return prisma.outbox_events.create({
    data: {
      siteId,
      topic: 'alerts.bark.inventory_low',
      aggregateType: 'dedicated_line_inventory',
      aggregateId: 'provider-account-1',
      desiredVersion: 1,
      idempotencyKey: `bark-event:${randomUUID()}`,
      dedupeKey: `bark-event:${randomUUID()}`,
      payload: {
        providerCode: 'NINE_EIGHT_FIVE',
        providerAccountId: 'provider-account-1',
        skuId: 'sku-1',
        countryCode: 'HK',
        requestedQuantity: 2,
        availableQuantity: 0,
        sourceVersion: 'snapshot-1',
      },
      ...overrides,
    },
  });
}
