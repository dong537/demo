import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  ReserveDedicatedLineStockUseCase,
  type InventoryReservationSource,
  type ReserveDedicatedLineStockInput,
} from './domain';

const input: ReserveDedicatedLineStockInput = {
  siteId: 'site-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
  providerCode: 'NINE_EIGHT_FIVE',
  providerAccountId: 'account-1',
  skuId: 'sku-sv',
  countryCode: 'HK',
  quantity: 2,
  idempotencyKey: 'order-1',
  orderSnapshot: {
    skuCode: 'SV',
    skuName: 'Short Video',
    durationDays: 30,
    unitPrice: '10',
    totalPrice: '20',
    currency: 'CNY',
    priceSource: 'SITE_DEFAULT_TEMPLATE',
    contractVersion: 1,
  },
  charge: { amount: '20', currency: 'CNY', idempotencyKey: 'debit-order-1' },
  jobPayload: { requestedBy: 'customer', durationDays: 30 },
};

function source(overrides: Partial<InventoryReservationSource> = {}): InventoryReservationSource {
  return {
    reserveAndEnqueue: vi.fn().mockResolvedValue({
      kind: 'RESERVED',
      orderId: 'order-1',
      reservationId: 'reservation-1',
      jobId: 'job-1',
      snapshotId: 'snapshot-1',
      sourceVersion: 'sync-1',
      replayed: false,
    }),
    enqueueInventoryLowAlert: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('ReserveDedicatedLineStockUseCase', () => {
  it('reserves stock and creates the external job through one source boundary', async () => {
    const inventory = source();

    const result = await new ReserveDedicatedLineStockUseCase(inventory).execute(input);

    expect(result).toMatchObject({ reservationId: 'reservation-1', jobId: 'job-1' });
    expect(inventory.reserveAndEnqueue).toHaveBeenCalledWith(input);
    expect(inventory.enqueueInventoryLowAlert).not.toHaveBeenCalled();
  });

  it('does not proceed to a provider when the reservation boundary reports insufficient stock', async () => {
    const inventory = source({
      reserveAndEnqueue: vi.fn().mockResolvedValue({
        kind: 'INSUFFICIENT',
        providerCode: input.providerCode,
        providerAccountId: input.providerAccountId,
        skuId: input.skuId,
        countryCode: input.countryCode,
        requestedQuantity: input.quantity,
        availableQuantity: 1,
        sourceVersion: 'sync-1',
      }),
    });

    await expect(new ReserveDedicatedLineStockUseCase(inventory).execute(input)).rejects.toMatchObject({
      code: ErrorCode.UPSTREAM_OUT_OF_STOCK,
      reasonKey: 'dedicated_line_inventory_insufficient',
    });
    expect(inventory.enqueueInventoryLowAlert).toHaveBeenCalledWith(expect.objectContaining({
      requestedQuantity: 2,
      availableQuantity: 1,
    }));
  });

  it('propagates an idempotency conflict without sending an alert', async () => {
    const inventory = source({
      reserveAndEnqueue: vi.fn().mockRejectedValue(
        new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'dedicated_line_order_idempotency_conflict', 409),
      ),
    });

    await expect(new ReserveDedicatedLineStockUseCase(inventory).execute(input)).rejects.toMatchObject({
      code: ErrorCode.IDEMPOTENCY_CONFLICT,
    });
    expect(inventory.enqueueInventoryLowAlert).not.toHaveBeenCalled();
  });

  it.each([
    ['quantity', { quantity: 0 }],
    ['country', { countryCode: 'Hong Kong' }],
    ['idempotency', { idempotencyKey: '' }],
  ])('rejects invalid %s before touching inventory', async (_, overrides) => {
    const inventory = source();
    await expect(new ReserveDedicatedLineStockUseCase(inventory).execute({ ...input, ...overrides })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
    });
    expect(inventory.reserveAndEnqueue).not.toHaveBeenCalled();
  });
});
