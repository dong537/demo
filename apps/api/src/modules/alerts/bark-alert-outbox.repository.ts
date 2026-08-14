import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { Prisma } from '@ipeasy/db/generated/client';

const BARK_INVENTORY_LOW_TOPIC = 'alerts.bark.inventory_low';

export type BarkOutboxEvent = Prisma.outbox_eventsGetPayload<Record<string, never>>;

@Injectable()
export class BarkAlertOutboxRepository {
  async findQueued(limit = 20): Promise<Array<Pick<BarkOutboxEvent, 'id'>>> {
    const now = new Date();
    return prisma.outbox_events.findMany({
      where: {
        topic: BARK_INVENTORY_LOW_TOPIC,
        status: { in: ['PENDING', 'RETRYING'] },
        nextRunAt: { lte: now },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      orderBy: [{ nextRunAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
      select: { id: true },
    });
  }

  async claimRunnableEvent(eventId: string, workerId: string, leaseMs = 30_000): Promise<BarkOutboxEvent | null> {
    const now = new Date();
    const result = await prisma.outbox_events.updateMany({
      where: {
        id: eventId,
        topic: BARK_INVENTORY_LOW_TOPIC,
        status: { in: ['PENDING', 'RETRYING'] },
        nextRunAt: { lte: now },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      data: {
        status: 'LEASED',
        attempt: { increment: 1 },
        leaseOwner: workerId,
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
      },
    });
    if (result.count !== 1) return null;
    return prisma.outbox_events.findUnique({ where: { id: eventId } });
  }

  async recoverExpiredLeases(): Promise<number> {
    const result = await prisma.outbox_events.updateMany({
      where: {
        topic: BARK_INVENTORY_LOW_TOPIC,
        status: 'LEASED',
        leaseExpiresAt: { lt: new Date() },
      },
      data: {
        status: 'NEEDS_OPERATOR',
        lastErrorCode: 'BARK_DELIVERY_LEASE_EXPIRED',
        lastErrorDetail: { reason: 'notification_delivery_may_have_succeeded' },
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    return result.count;
  }

  async markPublished(event: BarkOutboxEvent, workerId: string): Promise<void> {
    const result = await prisma.outbox_events.updateMany({
      where: leaseWhere(event, workerId),
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        lastErrorDetail: Prisma.JsonNull,
      },
    });
    assertUpdated(result.count);
  }

  async markRetryableFailure(
    event: BarkOutboxEvent,
    workerId: string,
    errorCode: string,
  ): Promise<'RETRYING' | 'FAILED'> {
    const exhausted = event.attempt >= event.maxAttempts;
    const result = await prisma.outbox_events.updateMany({
      where: leaseWhere(event, workerId),
      data: {
        status: exhausted ? 'FAILED' : 'RETRYING',
        nextRunAt: new Date(Date.now() + retryDelayMs(event.attempt)),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: errorCode,
        lastErrorDetail: { reason: errorCode },
      },
    });
    assertUpdated(result.count);
    return exhausted ? 'FAILED' : 'RETRYING';
  }

  async markFailed(event: BarkOutboxEvent, workerId: string, errorCode: string): Promise<void> {
    const result = await prisma.outbox_events.updateMany({
      where: leaseWhere(event, workerId),
      data: {
        status: 'FAILED',
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: errorCode,
        lastErrorDetail: { reason: errorCode },
      },
    });
    assertUpdated(result.count);
  }

  async markNeedsOperator(event: BarkOutboxEvent, workerId: string, errorCode: string): Promise<void> {
    const result = await prisma.outbox_events.updateMany({
      where: leaseWhere(event, workerId),
      data: {
        status: 'NEEDS_OPERATOR',
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: errorCode,
        lastErrorDetail: { reason: errorCode },
      },
    });
    assertUpdated(result.count);
  }
}

function leaseWhere(event: BarkOutboxEvent, workerId: string): Prisma.outbox_eventsWhereInput {
  return {
    id: event.id,
    topic: BARK_INVENTORY_LOW_TOPIC,
    status: 'LEASED',
    leaseOwner: workerId,
    desiredVersion: event.desiredVersion,
  };
}

function assertUpdated(count: number): void {
  if (count !== 1) throw new Error('bark_outbox_lease_lost');
}

function retryDelayMs(attempt: number): number {
  return Math.min(60_000, Math.max(1_000, 2 ** Math.min(attempt, 6) * 1_000));
}
