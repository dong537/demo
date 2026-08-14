import { Injectable } from '@nestjs/common';
import { AuthenticatedContext, requireUserContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { CatalogRepository } from '../catalog/catalog.repository';
import { DedicatedLineInventoryRepository } from './dedicated-line-inventory.repository';
import { DedicatedLinePlacementRepository } from './dedicated-line-placement.repository';
import { ReserveDedicatedLineStockUseCase } from './domain';
import type { CreateDedicatedLineOrderDto } from './dto';
import { SkuQuoteUseCase } from '../catalog/domain';

@Injectable()
export class CreateDedicatedLineOrderUseCase {
  constructor(
    private readonly catalog: CatalogRepository,
    private readonly inventory: DedicatedLineInventoryRepository,
    private readonly reserve: ReserveDedicatedLineStockUseCase,
    private readonly placements: DedicatedLinePlacementRepository,
    private readonly quote: SkuQuoteUseCase,
  ) {}

  async execute(ctx: AuthenticatedContext, dto: CreateDedicatedLineOrderDto) {
    requireUserContext(ctx);
    if (!ctx.tenantId) throw new AppError(ErrorCode.PERMISSION_DENIED, 'tenant_required', 403);
    assertRequest(dto);

    const sku = await this.catalog.findSku(ctx.siteId, dto.skuCode);
    if (!sku) throw new AppError(ErrorCode.NOT_FOUND, 'sku_not_found', 404);
    if (!sku.isActive || !sku.isVisible) throw new AppError(ErrorCode.PRODUCT_DISABLED, 'sku_not_saleable', 410);
    if (sku.capabilities['delivery'] !== 'dedicated-line') {
      throw new AppError(ErrorCode.UNSUPPORTED_CAPABILITY, 'sku_not_dedicated_line', 422);
    }

    const countryCode = dto.countryCode.trim().toUpperCase();
    const route = await this.inventory.findFreshRoute({
      siteId: ctx.siteId,
      tenantId: ctx.tenantId,
      skuId: sku.id,
      countryCode,
    });
    if (!route) {
      await this.inventory.enqueueInventoryLowAlert({
        siteId: ctx.siteId,
        tenantId: ctx.tenantId,
        userId: ctx.ownerId,
        providerCode: 'UNRESOLVED',
        providerAccountId: 'UNRESOLVED',
        skuId: sku.id,
        countryCode,
        requestedQuantity: dto.quantity,
        availableQuantity: 0,
        sourceVersion: null,
      });
      throw new AppError(ErrorCode.UPSTREAM_OUT_OF_STOCK, 'dedicated_line_inventory_unavailable', 422);
    }
    const placement = await this.placements.resolveForOrder({
      siteId: ctx.siteId,
      tenantId: ctx.tenantId,
      userId: ctx.ownerId,
      skuId: sku.id,
      quantity: dto.quantity,
    });
    const quote = await this.quote.execute({
      siteId: ctx.siteId,
      tenantId: ctx.tenantId,
      userId: ctx.ownerId,
      skuCode: sku.code,
      durationDays: dto.durationDays,
      quantity: dto.quantity,
      currency: dto.currency.trim().toUpperCase(),
    });

    const result = await this.reserve.execute({
      siteId: ctx.siteId,
      tenantId: ctx.tenantId,
      userId: ctx.ownerId,
      providerCode: route.providerCode,
      providerAccountId: route.providerAccountId,
      skuId: sku.id,
      countryCode,
      quantity: dto.quantity,
      idempotencyKey: dto.idempotencyKey,
      orderSnapshot: {
        skuCode: sku.code,
        skuName: sku.name,
        ...(dto.regionCode?.trim() ? { regionCode: dto.regionCode.trim() } : {}),
        ...(dto.businessType?.trim() ? { businessType: dto.businessType.trim() } : {}),
        durationDays: dto.durationDays,
        unitPrice: quote.unitPrice,
        totalPrice: quote.totalPrice,
        currency: quote.currency,
        priceSource: quote.priceSource,
        contractVersion: quote.contractVersion,
      },
      charge: {
        amount: quote.totalPrice,
        currency: quote.currency,
        idempotencyKey: `dedicated-line-debit:${ctx.siteId}:${ctx.tenantId}:${ctx.ownerId}:${dto.idempotencyKey.trim()}`,
      },
      jobPayload: {
        durationDays: dto.durationDays,
        currency: dto.currency.trim().toUpperCase(),
        protocol: 'SOCKS5',
        providerResourceId: route.providerResourceId,
        maxReplicaFanout: placement.targetReplicaCount,
        placementPolicyId: placement.policyId,
        inboundProfileId: placement.inboundProfileId,
        inboundTag: placement.inboundTag,
        lineProtocol: placement.protocol,
        pricingSnapshot: {
          unitPrice: quote.unitPrice,
          totalPrice: quote.totalPrice,
          currency: quote.currency,
          priceSource: quote.priceSource,
          contractVersion: quote.contractVersion,
        },
        ...(dto.regionCode?.trim() ? { regionCode: dto.regionCode.trim() } : {}),
        ...(dto.businessType?.trim() ? { businessType: dto.businessType.trim() } : {}),
      },
    });
    return {
      status: 'QUEUED' as const,
      orderId: result.orderId,
      reservationId: result.reservationId,
      jobId: result.jobId,
      skuCode: sku.code,
      countryCode,
      quantity: dto.quantity,
      replayed: result.replayed,
    };
  }
}

function assertRequest(dto: CreateDedicatedLineOrderDto): void {
  if (!dto.skuCode?.trim() || !/^[A-Z]{2}$/.test(dto.countryCode?.trim().toUpperCase() ?? '')) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'dedicated_line_order_fields_invalid', 400);
  }
  if (!Number.isInteger(dto.quantity) || dto.quantity < 1) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'quantity_invalid', 400);
  }
  if (!Number.isInteger(dto.durationDays) || dto.durationDays < 1) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'duration_days_invalid', 400);
  }
  if (!dto.currency?.trim() || !dto.idempotencyKey?.trim()) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'dedicated_line_order_fields_required', 400);
  }
}
