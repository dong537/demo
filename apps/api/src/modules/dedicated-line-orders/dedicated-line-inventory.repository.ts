import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { Prisma } from '@ipeasy/db/generated/client';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import type { InventoryItem, ProviderCode } from '../providers/provider.types';
import { inventoryFreshnessTtlSeconds } from '../resources/inventory-freshness';
import { WalletRepository } from '../wallet/wallet.repository';
import {
  type InventoryInsufficientResult,
  type InventoryLowAlert,
  type InventoryReservationSource,
  type ReserveDedicatedLineStockInput,
  type ReserveDedicatedLineStockResult,
} from './domain';

const RESERVATION_TTL_MS = 5 * 60 * 1000;
const PROVIDER_ORDER_JOB_KIND = 'PROVIDER_DEDICATED_LINE_ORDER';
const BARK_INVENTORY_LOW_TOPIC = 'alerts.bark.inventory_low';

@Injectable()
export class DedicatedLineInventoryRepository implements InventoryReservationSource {
  constructor(private readonly walletRepository: WalletRepository) {}

  async findFreshRoute(input: {
    siteId: string;
    tenantId: string;
    skuId: string;
    countryCode: string;
  }): Promise<{ providerCode: string; providerAccountId: string; providerResourceId: string } | null> {
    const snapshots = await prisma.dedicated_line_inventory_snapshots.findMany({
      where: {
        siteId: input.siteId,
        skuId: input.skuId,
        countryCode: input.countryCode.trim().toUpperCase(),
        expiresAt: { gt: new Date() },
      },
      orderBy: [{ capturedAt: 'desc' }, { createdAt: 'desc' }],
      take: 50,
      include: { providerAccount: { select: { status: true, tenantId: true } } },
    });
    const selected = snapshots.find((snapshot) =>
      snapshot.providerAccount.status === 'ACTIVE'
      && (snapshot.providerAccount.tenantId === null || snapshot.providerAccount.tenantId === input.tenantId)
      && snapshot.quantity - snapshot.reservedQuantity > 0,
    );
    return selected
      ? {
        providerCode: selected.providerCode,
        providerAccountId: selected.providerAccountId,
        providerResourceId: selected.providerResourceId,
      }
      : null;
  }

  async listFreshLocations(input: {
    siteId: string;
    tenantId: string;
  }): Promise<Array<{ countryCode: string; availableQuantity: number }>> {
    const snapshots = await prisma.dedicated_line_inventory_snapshots.findMany({
      where: { siteId: input.siteId, expiresAt: { gt: new Date() } },
      select: {
        countryCode: true,
        quantity: true,
        reservedQuantity: true,
        providerAccount: { select: { status: true, tenantId: true } },
        sku: { select: { capabilities: true, isActive: true, isVisible: true } },
      },
    });
    const byCountry = new Map<string, number>();
    for (const snapshot of snapshots) {
      if (
        snapshot.providerAccount.status !== 'ACTIVE'
        || (snapshot.providerAccount.tenantId !== null && snapshot.providerAccount.tenantId !== input.tenantId)
        || !snapshot.sku.isActive
        || !snapshot.sku.isVisible
        || !isDedicatedLineSku(snapshot.sku.capabilities)
      ) continue;
      const available = Math.max(0, snapshot.quantity - snapshot.reservedQuantity);
      if (available > 0) {
        const country = snapshot.countryCode.trim().toUpperCase();
        byCountry.set(country, (byCountry.get(country) ?? 0) + available);
      }
    }
    return [...byCountry.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([countryCode, availableQuantity]) => ({ countryCode, availableQuantity }));
  }

  async syncProviderSnapshot(input: {
    siteId: string;
    providerAccountId: string;
    providerCode: ProviderCode;
    items: InventoryItem[];
    capturedAt: Date;
  }): Promise<{ snapshots: number; mappedSkus: number }> {
    const skus = await prisma.service_skus.findMany({
      where: { siteId: input.siteId, isActive: true },
      select: { id: true, capabilities: true },
    });
    const ttlSeconds = inventoryFreshnessTtlSeconds(input.providerCode);
    let snapshots = 0;
    let mappedSkus = 0;
    for (const sku of skus) {
      const source = readInventorySource(sku.capabilities, input.providerCode);
      if (!source) continue;
      const allowed = new Set(source.providerResourceIds);
      let mappedThisSku = false;
      for (const item of input.items) {
        if (!allowed.has(item.providerResourceId)) continue;
        mappedThisSku = true;
        const countryCode = item.countryCode.trim().toUpperCase();
        const sourceVersion = stableSnapshotVersion(input, sku.id, [item.providerResourceId]);
        const expiresAt = new Date(input.capturedAt.getTime() + ttlSeconds * 1000);
        const existing = await prisma.dedicated_line_inventory_snapshots.findUnique({
          where: {
            siteId_providerAccountId_skuId_countryCode_providerResourceId_sourceVersion: {
              siteId: input.siteId,
              providerAccountId: input.providerAccountId,
              skuId: sku.id,
              countryCode,
              providerResourceId: item.providerResourceId,
              sourceVersion,
            },
          },
          select: { id: true, reservedQuantity: true },
        });
        if (existing) {
          await prisma.dedicated_line_inventory_snapshots.update({
            where: { id: existing.id },
            data: {
              quantity: Math.max(item.stock, existing.reservedQuantity),
              capturedAt: input.capturedAt,
              expiresAt,
            },
          });
        } else {
          await prisma.dedicated_line_inventory_snapshots.create({
            data: {
              siteId: input.siteId,
              providerAccountId: input.providerAccountId,
              skuId: sku.id,
              providerCode: input.providerCode,
              countryCode,
              providerResourceId: item.providerResourceId,
              quantity: item.stock,
              sourceVersion,
              capturedAt: input.capturedAt,
              expiresAt,
            },
          });
        }
        snapshots += 1;
      }
      if (mappedThisSku) mappedSkus += 1;
    }
    return { snapshots, mappedSkus };
  }

  async reserveAndEnqueue(
    input: ReserveDedicatedLineStockInput,
  ): Promise<ReserveDedicatedLineStockResult | InventoryInsufficientResult> {
    return prisma.$transaction(async (tx) => {
      await assertScope(tx, input);

      const existing = await tx.stock_reservations.findUnique({
        where: {
          siteId_tenantId_userId_idempotencyKey: {
            siteId: input.siteId,
            tenantId: input.tenantId,
            userId: input.userId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing) return replayExisting(tx, input, existing);

      const now = new Date();
      const snapshot = await tx.dedicated_line_inventory_snapshots.findFirst({
        where: {
          siteId: input.siteId,
          providerAccountId: input.providerAccountId,
          providerCode: input.providerCode,
          skuId: input.skuId,
          countryCode: input.countryCode,
          expiresAt: { gt: now },
        },
        orderBy: [{ capturedAt: 'desc' }, { createdAt: 'desc' }],
      });
      if (!snapshot) return insufficient(input, null, 0);

      const claimed = await tx.$executeRaw(Prisma.sql`
        UPDATE "dedicated_line_inventory_snapshots"
        SET "reservedQuantity" = "reservedQuantity" + ${input.quantity}
        WHERE "id" = ${snapshot.id}
          AND "expiresAt" > ${now}
          AND "quantity" - "reservedQuantity" >= ${input.quantity}
      `);
      if (claimed !== 1) {
        const current = await tx.dedicated_line_inventory_snapshots.findUnique({ where: { id: snapshot.id } });
        return insufficient(
          input,
          current?.sourceVersion ?? snapshot.sourceVersion,
          current ? Math.max(0, current.quantity - current.reservedQuantity) : 0,
        );
      }

      const order = await tx.dedicated_line_orders.create({
        data: {
          siteId: input.siteId,
          tenantId: input.tenantId,
          userId: input.userId,
          skuId: input.skuId,
          skuCode: input.orderSnapshot.skuCode.trim(),
          skuName: input.orderSnapshot.skuName.trim(),
          countryCode: input.countryCode,
          regionCode: input.orderSnapshot.regionCode?.trim() || null,
          businessType: input.orderSnapshot.businessType?.trim() || null,
          durationDays: input.orderSnapshot.durationDays,
          quantity: input.quantity,
          unitPrice: input.orderSnapshot.unitPrice,
          totalPrice: input.orderSnapshot.totalPrice,
          currency: input.orderSnapshot.currency.trim().toUpperCase(),
          priceSource: input.orderSnapshot.priceSource.trim(),
          contractVersion: input.orderSnapshot.contractVersion,
          idempotencyKey: input.idempotencyKey,
        },
      });

      const reservation = await tx.stock_reservations.create({
        data: {
          siteId: input.siteId,
          tenantId: input.tenantId,
          userId: input.userId,
          inventorySnapshotId: snapshot.id,
          providerAccountId: input.providerAccountId,
          skuId: input.skuId,
          dedicatedLineOrderId: order.id,
          providerCode: input.providerCode,
          countryCode: input.countryCode,
          quantity: input.quantity,
          snapshotVersion: snapshot.sourceVersion,
          idempotencyKey: input.idempotencyKey,
          expiresAt: new Date(Math.min(snapshot.expiresAt.getTime(), now.getTime() + RESERVATION_TTL_MS)),
        },
      });
      const wallet = await tx.wallets.findFirst({
        where: { siteId: input.siteId, tenantId: input.tenantId, userId: input.userId },
        select: { id: true },
      });
      if (!wallet) throw new AppError(ErrorCode.NOT_FOUND, 'wallet_not_found', 404);
      await this.walletRepository.debitWalletTx(
        tx,
        wallet.id,
        input.charge.amount,
        input.charge.currency.trim().toUpperCase(),
        'DEBIT',
        reservation.id,
        'dedicated_line_order',
        input.charge.idempotencyKey.trim(),
      );
      const jobKey = stableKey('dedicated-line-order', input.siteId, input.tenantId, input.userId, input.idempotencyKey);
      const job = await tx.external_jobs.create({
        data: {
          siteId: input.siteId,
          tenantId: input.tenantId,
          userId: input.userId,
          dedicatedLineOrderId: order.id,
          kind: PROVIDER_ORDER_JOB_KIND,
          aggregateType: 'stock_reservation',
          aggregateId: reservation.id,
          desiredVersion: 1,
          idempotencyKey: jobKey,
          dedupeKey: jobKey,
          payload: {
            reservationId: reservation.id,
            providerCode: input.providerCode,
            providerAccountId: input.providerAccountId,
            skuId: input.skuId,
            countryCode: input.countryCode,
            quantity: input.quantity,
            snapshotVersion: snapshot.sourceVersion,
            request: {
              ...(input.jobPayload as Prisma.InputJsonObject),
              providerResourceId: snapshot.providerResourceId,
            },
          },
        },
      });

      return {
        kind: 'RESERVED',
        orderId: order.id,
        reservationId: reservation.id,
        jobId: job.id,
        snapshotId: snapshot.id,
        sourceVersion: snapshot.sourceVersion,
        replayed: false,
      };
    });
  }

  async enqueueInventoryLowAlert(alert: InventoryLowAlert): Promise<void> {
    const version = alert.sourceVersion ?? 'missing';
    const eventKey = stableKey(
      'inventory-low',
      alert.siteId,
      alert.providerAccountId,
      alert.skuId,
      alert.countryCode,
      version,
    );
    try {
      await prisma.outbox_events.create({
        data: {
          siteId: alert.siteId,
          tenantId: alert.tenantId,
          userId: alert.userId,
          topic: BARK_INVENTORY_LOW_TOPIC,
          aggregateType: 'dedicated_line_inventory',
          aggregateId: alert.providerAccountId,
          desiredVersion: 1,
          idempotencyKey: eventKey,
          dedupeKey: eventKey,
          payload: {
            providerCode: alert.providerCode,
            providerAccountId: alert.providerAccountId,
            skuId: alert.skuId,
            countryCode: alert.countryCode,
            requestedQuantity: alert.requestedQuantity,
            availableQuantity: alert.availableQuantity,
            sourceVersion: alert.sourceVersion ?? null,
          },
        },
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
      throw error;
    }
  }
}

function isDedicatedLineSku(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return (value as Record<string, unknown>)['delivery'] === 'dedicated-line';
}

async function assertScope(tx: Prisma.TransactionClient, input: ReserveDedicatedLineStockInput): Promise<void> {
  const [buyer, sku, providerAccount] = await Promise.all([
    tx.users.findFirst({ where: { id: input.userId, siteId: input.siteId, tenantId: input.tenantId }, select: { id: true } }),
    tx.service_skus.findFirst({
      where: { id: input.skuId, siteId: input.siteId },
      select: { id: true, isActive: true, isVisible: true },
    }),
    tx.provider_accounts.findFirst({
      where: {
        id: input.providerAccountId,
        siteId: input.siteId,
        providerCode: input.providerCode,
        OR: [{ tenantId: null }, { tenantId: input.tenantId }],
      },
      select: { id: true, status: true },
    }),
  ]);
  if (!buyer) throw new AppError(ErrorCode.NOT_FOUND, 'user_not_found', 404);
  if (!sku) throw new AppError(ErrorCode.NOT_FOUND, 'sku_not_found', 404);
  if (!sku.isActive || !sku.isVisible) throw new AppError(ErrorCode.PRODUCT_DISABLED, 'sku_not_saleable', 410);
  if (!providerAccount) throw new AppError(ErrorCode.NOT_FOUND, 'provider_account_not_found', 404);
  if (providerAccount.status !== 'ACTIVE') throw new AppError(ErrorCode.UPSTREAM_DISABLED, 'provider_disabled', 422);
}

async function replayExisting(
  tx: Prisma.TransactionClient,
  input: ReserveDedicatedLineStockInput,
  existing: Awaited<ReturnType<Prisma.TransactionClient['stock_reservations']['findUniqueOrThrow']>>,
): Promise<ReserveDedicatedLineStockResult> {
  if (
    existing.providerAccountId !== input.providerAccountId
    || existing.providerCode !== input.providerCode
    || existing.skuId !== input.skuId
    || existing.countryCode !== input.countryCode
    || existing.quantity !== input.quantity
  ) {
    throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'dedicated_line_order_idempotency_conflict', 409);
  }
  const job = await tx.external_jobs.findFirst({
    where: {
      siteId: input.siteId,
      aggregateType: 'stock_reservation',
      aggregateId: existing.id,
      kind: PROVIDER_ORDER_JOB_KIND,
    },
    select: { id: true, dedicatedLineOrderId: true },
  });
  if (!job) throw new AppError(ErrorCode.INTERNAL_ERROR, 'dedicated_line_order_job_missing', 500);
  if (!existing.dedicatedLineOrderId || job.dedicatedLineOrderId !== existing.dedicatedLineOrderId) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'dedicated_line_order_snapshot_missing', 500);
  }
  const order = await tx.dedicated_line_orders.findUnique({ where: { id: existing.dedicatedLineOrderId } });
  if (!order || !sameOrderSnapshot(order, input)) {
    throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'dedicated_line_order_idempotency_conflict', 409);
  }
  return {
    kind: 'RESERVED',
    orderId: existing.dedicatedLineOrderId,
    reservationId: existing.id,
    jobId: job.id,
    snapshotId: existing.inventorySnapshotId,
    sourceVersion: existing.snapshotVersion,
    replayed: true,
  };
}

function sameOrderSnapshot(
  order: {
    skuCode: string;
    skuName: string;
    regionCode: string | null;
    businessType: string | null;
    durationDays: number;
    quantity: number;
    unitPrice: Prisma.Decimal;
    totalPrice: Prisma.Decimal;
    currency: string;
    priceSource: string;
    contractVersion: number;
  },
  input: ReserveDedicatedLineStockInput,
): boolean {
  const snapshot = input.orderSnapshot;
  return order.skuCode === snapshot.skuCode.trim()
    && order.skuName === snapshot.skuName.trim()
    && order.regionCode === (snapshot.regionCode?.trim() || null)
    && order.businessType === (snapshot.businessType?.trim() || null)
    && order.durationDays === snapshot.durationDays
    && order.quantity === input.quantity
    && order.unitPrice.toString() === snapshot.unitPrice
    && order.totalPrice.toString() === snapshot.totalPrice
    && order.currency === snapshot.currency.trim().toUpperCase()
    && order.priceSource === snapshot.priceSource.trim()
    && order.contractVersion === snapshot.contractVersion;
}

function insufficient(
  input: ReserveDedicatedLineStockInput,
  sourceVersion: string | null,
  availableQuantity: number,
): InventoryInsufficientResult {
  return {
    kind: 'INSUFFICIENT',
    providerCode: input.providerCode,
    providerAccountId: input.providerAccountId,
    skuId: input.skuId,
    countryCode: input.countryCode,
    requestedQuantity: input.quantity,
    availableQuantity,
    sourceVersion,
  };
}

type InventorySource = { providerCode: string; providerResourceIds: string[] };

function readInventorySource(value: unknown, providerCode: string): InventorySource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const capabilities = value as Record<string, unknown>;
  const candidate = capabilities['inventorySource'];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const source = candidate as Record<string, unknown>;
  if (source['providerCode'] !== providerCode || !Array.isArray(source['providerResourceIds'])) return null;
  const providerResourceIds = source['providerResourceIds']
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
  return providerResourceIds.length > 0 ? { providerCode, providerResourceIds } : null;
}

function stableSnapshotVersion(
  input: { providerAccountId: string; providerCode: string; capturedAt: Date },
  skuId: string,
  providerResourceIds: string[],
): string {
  return createHash('sha256')
    .update([input.providerAccountId, input.providerCode, skuId, input.capturedAt.toISOString(), ...providerResourceIds].join('\0'))
    .digest('hex');
}

function stableKey(prefix: string, ...parts: string[]): string {
  return `${prefix}:${createHash('sha256').update(parts.join('\0')).digest('hex')}`;
}
