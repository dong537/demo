import { Injectable } from '@nestjs/common';
import { Prisma, prisma } from '@ipeasy/db';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  ServiceSku,
  SkuPriceCandidate,
  SkuPriceCandidateSet,
  SkuPriceSource,
  SkuQuoteSource,
} from './domain';

@Injectable()
export class CatalogRepository implements SkuQuoteSource {
  async assertBuyerScope(siteId: string, tenantId: string, userId: string): Promise<void> {
    const buyer = await prisma.users.findFirst({
      where: { id: userId, siteId, tenantId },
      select: { id: true },
    });
    if (!buyer) {
      throw new AppError(ErrorCode.NOT_FOUND, 'user_not_found', 404);
    }
  }

  async listSkus(siteId: string, includeInactive = false): Promise<ServiceSku[]> {
    const rows = await prisma.service_skus.findMany({
      where: {
        siteId,
        ...(includeInactive ? {} : { isActive: true, isVisible: true }),
      },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    return rows.map(toServiceSku);
  }

  async listSaleableSkusForBuyer(siteId: string, tenantId: string, userId: string): Promise<ServiceSku[]> {
    const [tenant, binding, tenantDefaultTemplate] = await Promise.all([
      prisma.tenants.findFirst({ where: { id: tenantId, siteId }, select: { ownerUserId: true } }),
      prisma.user_price_bindings.findFirst({
        where: { siteId, tenantId, userId },
        select: { templateId: true },
      }),
      prisma.price_templates.findFirst({
        where: { siteId, tenantId, isDefault: true },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      }),
    ]);
    if (!tenant) throw new AppError(ErrorCode.NOT_FOUND, 'tenant_not_found', 404);

    const skus = await this.listSkus(siteId, false);
    const dedicatedSkus = skus.filter((sku) => sku.capabilities['delivery'] === 'dedicated-line');
    if (!tenant.ownerUserId) return dedicatedSkus;

    const templateIds = [binding?.templateId, tenantDefaultTemplate?.id].filter((id): id is string => Boolean(id));
    const [userOverrides, templateRules] = await Promise.all([
      prisma.user_sku_price_overrides.findMany({
        where: { siteId, tenantId, userId },
        select: { skuId: true },
      }),
      templateIds.length > 0
        ? prisma.sku_price_rules.findMany({
          where: { siteId, templateId: { in: templateIds } },
          select: { skuId: true },
        })
        : Promise.resolve([]),
    ]);
    const enabledSkuIds = new Set([...userOverrides, ...templateRules].map((rule) => rule.skuId));
    return dedicatedSkus.filter((sku) => enabledSkuIds.has(sku.id));
  }

  async findSku(siteId: string, skuCode: string): Promise<ServiceSku | null> {
    const row = await prisma.service_skus.findUnique({
      where: { siteId_code: { siteId, code: skuCode.trim().toUpperCase() } },
    });
    return row ? toServiceSku(row) : null;
  }

  async getPriceCandidates(input: {
    siteId: string;
    tenantId: string;
    userId: string;
    skuId: string;
    durationDays: number;
    quantity: number;
  }): Promise<SkuPriceCandidateSet[]> {
    const [tenant, binding, tenantDefaultTemplate, siteDefaultTemplate] = await Promise.all([
      prisma.tenants.findFirst({ where: { id: input.tenantId, siteId: input.siteId }, select: { ownerUserId: true } }),
      prisma.user_price_bindings.findFirst({
        where: { siteId: input.siteId, tenantId: input.tenantId, userId: input.userId },
        select: { templateId: true },
      }),
      prisma.price_templates.findFirst({
        where: { siteId: input.siteId, tenantId: input.tenantId, isDefault: true },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      }),
      prisma.price_templates.findFirst({
        where: { siteId: input.siteId, tenantId: null, isDefault: true },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      }),
    ]);
    if (!tenant) throw new AppError(ErrorCode.NOT_FOUND, 'tenant_not_found', 404);

    const priceWhere = {
      siteId: input.siteId,
      skuId: input.skuId,
      durationDays: input.durationDays,
      minQty: { lte: input.quantity },
    };
    const [userOverride, userTemplate, tenantDefault, siteOverride, siteDefault] = await Promise.all([
      prisma.user_sku_price_overrides.findMany({
        where: { ...priceWhere, tenantId: input.tenantId, userId: input.userId },
        orderBy: { minQty: 'desc' },
      }),
      binding
        ? prisma.sku_price_rules.findMany({
          where: { ...priceWhere, templateId: binding.templateId },
          orderBy: { minQty: 'desc' },
        })
        : Promise.resolve([]),
      tenantDefaultTemplate
        ? prisma.sku_price_rules.findMany({
          where: { ...priceWhere, templateId: tenantDefaultTemplate.id },
          orderBy: { minQty: 'desc' },
        })
        : Promise.resolve([]),
      tenant.ownerUserId
        ? Promise.resolve([])
        : prisma.sku_price_overrides.findMany({
          where: priceWhere,
          orderBy: { minQty: 'desc' },
        }),
      tenant.ownerUserId || !siteDefaultTemplate
        ? Promise.resolve([])
        : prisma.sku_price_rules.findMany({
          where: { ...priceWhere, templateId: siteDefaultTemplate.id },
          orderBy: { minQty: 'desc' },
        }),
    ]);

    return [
      toCandidateSet('USER_OVERRIDE', userOverride),
      toCandidateSet('USER_TEMPLATE', userTemplate),
      toCandidateSet('TENANT_DEFAULT_TEMPLATE', tenantDefault),
      toCandidateSet('SITE_OVERRIDE', siteOverride),
      toCandidateSet('SITE_DEFAULT_TEMPLATE', siteDefault),
    ];
  }
}

type SkuRow = Prisma.service_skusGetPayload<Record<string, never>>;
type SkuPriceRow = { unitPrice: Prisma.Decimal; currency: string };

function toServiceSku(row: SkuRow): ServiceSku {
  if (row.capabilities === null || Array.isArray(row.capabilities) || typeof row.capabilities !== 'object') {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'sku_capabilities_invalid', 500);
  }
  return {
    id: row.id,
    siteId: row.siteId,
    code: row.code,
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    isVisible: row.isVisible,
    contractVersion: row.contractVersion,
    capabilities: row.capabilities as Record<string, unknown>,
  };
}

function toCandidateSet(source: SkuPriceSource, rows: SkuPriceRow[]): SkuPriceCandidateSet {
  const candidates: SkuPriceCandidate[] = rows.map((row) => ({
    unitPrice: row.unitPrice.toString(),
    currency: row.currency,
    source,
  }));
  return { source, candidates, hasCurrencyMismatch: candidates.length > 0 };
}
