import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

export interface ReserveDedicatedLineStockInput {
  siteId: string;
  tenantId: string;
  userId: string;
  providerCode: string;
  providerAccountId: string;
  skuId: string;
  countryCode: string;
  quantity: number;
  idempotencyKey: string;
  orderSnapshot: {
    skuCode: string;
    skuName: string;
    regionCode?: string;
    businessType?: string;
    durationDays: number;
    unitPrice: string;
    totalPrice: string;
    currency: string;
    priceSource: string;
    contractVersion: number;
  };
  charge: {
    amount: string;
    currency: string;
    idempotencyKey: string;
  };
  jobPayload: Record<string, unknown>;
}

export type InventoryLowAlert = {
  siteId: string;
  tenantId: string;
  userId: string;
  providerCode: string;
  providerAccountId: string;
  skuId: string;
  countryCode: string;
  requestedQuantity: number;
  availableQuantity: number;
  sourceVersion: string | null;
};

export type ReserveDedicatedLineStockResult = {
  kind: 'RESERVED';
  reservationId: string;
  orderId: string;
  jobId: string;
  snapshotId: string;
  sourceVersion: string;
  replayed: boolean;
};

export type InventoryInsufficientResult = {
  kind: 'INSUFFICIENT';
  providerCode: string;
  providerAccountId: string;
  skuId: string;
  countryCode: string;
  requestedQuantity: number;
  availableQuantity: number;
  sourceVersion: string | null;
};

export interface InventoryReservationSource {
  reserveAndEnqueue(
    input: ReserveDedicatedLineStockInput,
  ): Promise<ReserveDedicatedLineStockResult | InventoryInsufficientResult>;
  enqueueInventoryLowAlert(alert: InventoryLowAlert): Promise<void>;
}

export class ReserveDedicatedLineStockUseCase {
  constructor(private readonly source: InventoryReservationSource) {}

  async execute(input: ReserveDedicatedLineStockInput): Promise<ReserveDedicatedLineStockResult> {
    assertInput(input);
    const normalizedInput = {
      ...input,
      providerCode: input.providerCode.trim(),
      countryCode: input.countryCode.trim().toUpperCase(),
      idempotencyKey: input.idempotencyKey.trim(),
    };

    const result = await this.source.reserveAndEnqueue(normalizedInput);
    if (result.kind === 'INSUFFICIENT') {
      await this.source.enqueueInventoryLowAlert({
        siteId: normalizedInput.siteId,
        tenantId: normalizedInput.tenantId,
        userId: normalizedInput.userId,
        ...result,
      });
      throw new AppError(ErrorCode.UPSTREAM_OUT_OF_STOCK, 'dedicated_line_inventory_insufficient', 422, undefined, {
        providerCode: result.providerCode,
        skuId: result.skuId,
        countryCode: result.countryCode,
        requestedQuantity: result.requestedQuantity,
        availableQuantity: result.availableQuantity,
        sourceVersion: result.sourceVersion,
      });
    }

    return result;
  }
}

function assertInput(input: ReserveDedicatedLineStockInput): void {
  if (!input.siteId || !input.tenantId || !input.userId || !input.providerCode || !input.providerAccountId || !input.skuId) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'dedicated_line_order_scope_required', 400);
  }
  if (!/^[A-Z]{2}$/.test(input.countryCode.trim().toUpperCase())) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'country_code_invalid', 400);
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'quantity_invalid', 400);
  }
  if (!input.idempotencyKey.trim()) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'idempotency_key_required', 400);
  }
  if (!input.charge || typeof input.charge.amount !== 'string' || !input.charge.amount.trim()) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'dedicated_line_charge_required', 400);
  }
  if (!input.charge.currency?.trim() || !input.charge.idempotencyKey?.trim()) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'dedicated_line_charge_required', 400);
  }
  if (!input.jobPayload || typeof input.jobPayload !== 'object' || Array.isArray(input.jobPayload)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'job_payload_invalid', 400);
  }
  const snapshot = input.orderSnapshot;
  if (
    !snapshot
    || !snapshot.skuCode?.trim()
    || !snapshot.skuName?.trim()
    || snapshot.durationDays !== input.jobPayload['durationDays']
    || !snapshot.unitPrice?.trim()
    || !snapshot.totalPrice?.trim()
    || !snapshot.currency?.trim()
    || !snapshot.priceSource?.trim()
    || !Number.isInteger(snapshot.contractVersion)
    || snapshot.contractVersion < 1
  ) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'dedicated_line_order_snapshot_invalid', 400);
  }
}
