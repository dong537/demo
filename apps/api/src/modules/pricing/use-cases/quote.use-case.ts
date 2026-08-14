import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PricingRepository } from '../pricing.repository';
import { ResourcesRepository } from '../../resources/resources.repository';
import { QuoteInput, QuoteResult } from '../domain';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { getBaseStaticProxyPrice, isManagedStaticProxyProviderCode } from '../base-price';
import { hasBuyableInventory } from '../../resources/domain';
import { SyncInventoryUseCase } from '../../resources/use-cases/sync-inventory.use-case';
import { ProviderCode } from '../../providers/provider.types';

@Injectable()
export class QuoteUseCase {
  constructor(
    private readonly pricingRepo: PricingRepository,
    private readonly resourcesRepo: ResourcesRepository,
    private readonly syncInventory: SyncInventoryUseCase,
  ) {}

  async execute(input: QuoteInput): Promise<QuoteResult> {
    assertQuoteInput(input);

    const resource = await this.resourcesRepo.findByIdInSite(input.resourceId, input.siteId);
    if (!resource) {
      throw new AppError(ErrorCode.NOT_FOUND, 'resource_not_found', 404);
    }

    if (resource.type === 'COUNTRY' && !(await this.resourcesRepo.hasProviderMapping(input.siteId, resource.id, resource.providerCode))) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'resource_not_purchasable', 422);
    }

    if (resource.status !== 'ACTIVE' || !resource.isVisible || !resource.isSaleable) {
      throw new AppError(ErrorCode.UPSTREAM_OUT_OF_STOCK, resource.unsaleableReason ?? 'resource_not_saleable', 422);
    }

    const currentUpstreamAccountId = await this.syncInventory.resolveActiveUpstreamAccountId(
      input.siteId,
      resource.providerCode as ProviderCode,
      input.tenantId,
    );
    if ((resource.upstreamAccountId ?? null) !== currentUpstreamAccountId) {
      throw new AppError(ErrorCode.UPSTREAM_OUT_OF_STOCK, 'upstream_resource_not_returned', 422);
    }

    const inventory = await this.ensureFreshInventory(input, resource, currentUpstreamAccountId);
    if (!hasBuyableInventory(resource.providerCode, inventory.stock)) {
      throw new AppError(ErrorCode.UPSTREAM_OUT_OF_STOCK, 'out_of_stock', 422);
    }

    const priceResult = await this.resolvePrice(resource.providerCode, resource.code, input);

    if (!priceResult) {
      throw new AppError(ErrorCode.PRICE_MISSING, 'no_price_rule', 422);
    }

    const unitPrice = new Decimal(priceResult.unitPrice);
    const totalPrice = unitPrice.mul(input.quantity);

    return {
      unitPrice: unitPrice.toFixed(),
      totalPrice: totalPrice.toFixed(),
      currency: priceResult.currency,
      resourceId: input.resourceId,
      durationDays: input.durationDays,
      quantity: input.quantity,
      priceSource: priceResult.source,
      isSaleable: true,
    };
  }

  private async resolvePrice(
    providerCode: string,
    resourceCode: string,
    input: QuoteInput,
  ): Promise<{ unitPrice: string; currency: string; source: QuoteResult['priceSource'] } | null> {
    const priceResult = await this.pricingRepo.getPriceForUser(
      input.siteId,
      input.userId,
      input.resourceId,
      input.durationDays,
      input.quantity,
      input.currency,
    );
    if (priceResult) return priceResult;
    const basePrice = getBaseStaticProxyPrice({
      code: resourceCode,
      providerCode,
      durationDays: input.durationDays,
      currency: input.currency,
    });
    if (basePrice) return basePrice;
    if (isManagedStaticProxyProviderCode(providerCode)) {
      throw new AppError(ErrorCode.CURRENCY_NOT_SUPPORTED, 'currency_not_supported', 422);
    }
    return null;
  }

  private async ensureFreshInventory(
    input: QuoteInput,
    resource: { id: string; providerCode: string; upstreamAccountId?: string | null },
    currentUpstreamAccountId: string | null,
  ): Promise<{ stock: number | null; isStale: boolean; capturedAt?: Date }> {
    let latest = await this.resourcesRepo.getLatestInventory(input.resourceId, input.siteId, currentUpstreamAccountId);
    if (latest && !latest.isStale) {
      const refreshForProviderConfig = latest.capturedAt
        ? await this.syncInventory.requiresRefreshForProviderConfig(
          input.siteId,
          resource.providerCode as ProviderCode,
          input.tenantId,
          latest.capturedAt,
          currentUpstreamAccountId,
        )
        : false;
      if (!refreshForProviderConfig) return latest;
    }

    await this.syncInventory.execute(input.siteId, resource.providerCode as ProviderCode, input.tenantId, currentUpstreamAccountId);
    latest = await this.resourcesRepo.getLatestInventory(input.resourceId, input.siteId, currentUpstreamAccountId);
    if (!latest || latest.isStale) {
      throw new AppError(ErrorCode.UPSTREAM_ERROR, 'inventory_stale', 422);
    }
    return latest;
  }
}

function assertQuoteInput(input: QuoteInput): void {
  if (!input.siteId || !input.tenantId || !input.userId || !input.resourceId) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'quote_required_fields_missing', 400);
  }
  if (!Number.isInteger(input.durationDays) || input.durationDays < 1) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'duration_days_invalid', 400);
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'quantity_invalid', 400);
  }
  if (!input.currency) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'currency_required', 400);
  }
}
