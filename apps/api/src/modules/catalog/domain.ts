import Decimal from 'decimal.js';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

export const SKU_PRICE_PRIORITY = [
  'USER_OVERRIDE',
  'USER_TEMPLATE',
  'TENANT_DEFAULT_TEMPLATE',
  'SITE_OVERRIDE',
  'SITE_DEFAULT_TEMPLATE',
] as const;

export type SkuPriceSource = (typeof SKU_PRICE_PRIORITY)[number];
export type SkuCapabilities = Readonly<Record<string, unknown>>;

export interface ServiceSku {
  id: string;
  siteId: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  isVisible: boolean;
  contractVersion: number;
  capabilities: Record<string, unknown>;
}

export interface SkuPriceCandidate {
  unitPrice: string;
  currency: string;
  source: SkuPriceSource;
}

export interface SkuPriceCandidateSet {
  source: SkuPriceSource;
  candidates: SkuPriceCandidate[];
  hasCurrencyMismatch: boolean;
}

export interface SkuQuoteInput {
  siteId: string;
  tenantId: string;
  userId: string;
  skuCode: string;
  durationDays: number;
  quantity: number;
  currency: string;
}

export interface SkuQuoteContract {
  readonly skuId: string;
  readonly skuCode: string;
  readonly name: string;
  readonly description: string | null;
  readonly version: number;
  readonly capabilities: SkuCapabilities;
}

export type SkuQuoteResult = Readonly<{
  skuId: string;
  skuCode: string;
  durationDays: number;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
  currency: string;
  priceSource: SkuPriceSource;
  contractVersion: number;
  contract: Readonly<SkuQuoteContract>;
}>;

export interface SkuQuoteSource {
  assertBuyerScope(siteId: string, tenantId: string, userId: string): Promise<void>;
  findSku(siteId: string, skuCode: string): Promise<ServiceSku | null>;
  getPriceCandidates(input: {
    siteId: string;
    tenantId: string;
    userId: string;
    skuId: string;
    durationDays: number;
    quantity: number;
  }): Promise<SkuPriceCandidateSet[]>;
}

export function selectSkuPrice(
  candidateSets: SkuPriceCandidateSet[],
  currency: string,
): SkuPriceCandidate | null {
  for (const source of SKU_PRICE_PRIORITY) {
    const set = candidateSets.find((candidateSet) => candidateSet.source === source);
    if (!set || set.candidates.length === 0) continue;

    const candidate = set.candidates.find((item) => item.currency === currency);
    if (candidate) return candidate;
    if (set.hasCurrencyMismatch) {
      throw new AppError(ErrorCode.CURRENCY_NOT_SUPPORTED, 'sku_currency_not_supported', 422);
    }
  }
  return null;
}

export class SkuQuoteUseCase {
  constructor(private readonly source: SkuQuoteSource) {}

  async execute(input: SkuQuoteInput): Promise<SkuQuoteResult> {
    assertSkuQuoteInput(input);
    await this.source.assertBuyerScope(input.siteId, input.tenantId, input.userId);

    const sku = await this.source.findSku(input.siteId, input.skuCode);
    if (!sku) {
      throw new AppError(ErrorCode.NOT_FOUND, 'sku_not_found', 404);
    }
    if (!sku.isActive || !sku.isVisible) {
      throw new AppError(ErrorCode.PRODUCT_DISABLED, 'sku_not_saleable', 410);
    }
    if (sku.capabilities['delivery'] !== 'dedicated-line') {
      throw new AppError(ErrorCode.UNSUPPORTED_CAPABILITY, 'sku_not_dedicated_line', 422);
    }

    const candidateSets = await this.source.getPriceCandidates({
      siteId: input.siteId,
      tenantId: input.tenantId,
      userId: input.userId,
      skuId: sku.id,
      durationDays: input.durationDays,
      quantity: input.quantity,
    });
    const price = selectSkuPrice(candidateSets, input.currency);
    if (!price) {
      throw new AppError(ErrorCode.PRICE_MISSING, 'no_sku_price_rule', 422);
    }

    const unitPrice = new Decimal(price.unitPrice);
    if (!unitPrice.isFinite() || unitPrice.isNegative()) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 'sku_price_invalid', 500);
    }

    const capabilities = cloneAndFreezeJson(sku.capabilities) as SkuCapabilities;
    const contract = Object.freeze({
      skuId: sku.id,
      skuCode: sku.code,
      name: sku.name,
      description: sku.description,
      version: sku.contractVersion,
      capabilities,
    });

    return Object.freeze({
      skuId: sku.id,
      skuCode: sku.code,
      durationDays: input.durationDays,
      quantity: input.quantity,
      unitPrice: unitPrice.toFixed(),
      totalPrice: unitPrice.mul(input.quantity).toFixed(),
      currency: price.currency,
      priceSource: price.source,
      contractVersion: sku.contractVersion,
      contract,
    });
  }
}

function assertSkuQuoteInput(input: SkuQuoteInput): void {
  if (!input.siteId || !input.tenantId || !input.userId || !input.skuCode?.trim()) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'sku_quote_required_fields_missing', 400);
  }
  if (!Number.isInteger(input.durationDays) || input.durationDays < 1) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'duration_days_invalid', 400);
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'quantity_invalid', 400);
  }
  if (!input.currency?.trim()) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'currency_required', 400);
  }
}

function cloneAndFreezeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(cloneAndFreezeJson));
  }
  if (value !== null && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneAndFreezeJson(item)]),
    ));
  }
  return value;
}
