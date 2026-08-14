import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { IpType, Prisma } from '@ipeasy/db/generated/client';
import Decimal from 'decimal.js';
import { PageQueryDto, PageResult } from '../../common/pagination/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PriceCandidate, selectPriceCandidate } from './domain';
import { resolvePricingResourceIds } from './price-scopes';
import { buildCurrentResourceAccountWhere } from '../providers/current-resource-account-filter';
import { isInventorySnapshotStale } from '../resources/domain';

export interface PriceResult {
  unitPrice: string;
  currency: string;
  source: 'USER_OVERRIDE' | 'USER_TEMPLATE' | 'TENANT_DEFAULT_TEMPLATE' | 'RESOURCE_OVERRIDE' | 'DEFAULT_TEMPLATE';
}

export type PriceTemplateListItem = Prisma.price_templatesGetPayload<{
  include: {
    price_rules: {
      include: {
        resource: {
          select: {
            id: true;
            code: true;
            name: true;
          };
        };
      };
      orderBy: [{ durationDays: 'asc' }, { createdAt: 'asc' }];
    };
  };
}>;

export type CreateTemplateInput = {
  siteId: string;
  name: string;
  description?: string | null;
  isDefault?: boolean;
};

export type UpsertPriceRuleInput = {
  siteId: string;
  templateId: string;
  resourceId: string;
  durationDays: number;
  unitPrice: string;
  currency: string;
  minQty?: number;
};

export type PricingMatrixQuery = PageQueryDto & {
  providerCode?: string;
  ipType?: string;
  stockState?: string;
  durationDays?: string | number;
  currency?: string;
  configurableOnly?: string | boolean;
  includeTotal?: string | boolean;
  withInventory?: string | boolean;
  tenantId?: string | null;
};

export type PricingMatrixSummaryQuery = {
  providerCode?: string;
  durationDays?: string | number;
  currency?: string;
  tenantId?: string | null;
};

export type PricingMatrixItem = {
  resourceId: string;
  code: string;
  name: string;
  displayName: string | null;
  providerCode: string;
  ipType: string;
  protocol: string;
  status: string;
  isSaleable: boolean;
  stock: number | null;
  inventoryCapturedAt: Date | null;
  inventoryIsStale: boolean | null;
  overridePrice: string | null;
  effectivePrice: string | null;
  currency: string | null;
  upstreamCost: string | null;
  upstreamCostCurrency: string | null;
};

export type PricingMatrixSummaryItem = {
  providerCode: string;
  total: number;
  enabled: number;
  synced: number;
  priced: number;
};

export type DedicatedSkuPricingItem = {
  skuId: string;
  code: string;
  name: string;
  description: string | null;
  templateRules: Array<{ id: string; durationDays: number; minQty: number; unitPrice: string; currency: string }>;
  globalOverrides: Array<{ id: string; durationDays: number; minQty: number; unitPrice: string; currency: string }>;
};

type MatrixResourceRow = Prisma.platform_resourcesGetPayload<Record<string, never>> & {
  inventory_snapshots?: Array<{
    stock: number;
    capturedAt: Date;
    freshnessTtlSeconds: number;
    isStale: boolean;
  }>;
};

const PRICING_MATRIX_DEFAULT_PAGE_SIZE = 20;
const PRICING_MATRIX_MAX_PAGE_SIZE = 20;

@Injectable()
export class PricingRepository {
  async listDedicatedSkuPricing(siteId: string): Promise<{
    templateId: string | null;
    items: DedicatedSkuPricingItem[];
  }> {
    const skus = await prisma.service_skus.findMany({
      where: {
        siteId,
        isActive: true,
        isVisible: true,
        capabilities: { path: ['delivery'], equals: 'dedicated-line' },
      },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    const template = await prisma.price_templates.findFirst({
      where: { siteId, tenantId: null, isDefault: true },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    const skuIds = skus.map((sku) => sku.id);
    const [rules, overrides] = await Promise.all([
      template && skuIds.length > 0
        ? prisma.sku_price_rules.findMany({ where: { siteId, templateId: template.id, skuId: { in: skuIds } }, orderBy: [{ durationDays: 'asc' }, { minQty: 'desc' }] })
        : Promise.resolve([]),
      skuIds.length > 0
        ? prisma.sku_price_overrides.findMany({ where: { siteId, skuId: { in: skuIds } }, orderBy: [{ durationDays: 'asc' }, { minQty: 'desc' }] })
        : Promise.resolve([]),
    ]);
    return {
      templateId: template?.id ?? null,
      items: skus.map((sku) => ({
        skuId: sku.id,
        code: sku.code,
        name: sku.name,
        description: sku.description,
        templateRules: rules.filter((rule) => rule.skuId === sku.id).map(toDedicatedSkuPriceRule),
        globalOverrides: overrides.filter((override) => override.skuId === sku.id).map(toDedicatedSkuPriceRule),
      })),
    };
  }

  async upsertDedicatedSkuOverride(input: {
    siteId: string;
    skuId: string;
    durationDays: number;
    minQty: number;
    unitPrice: string;
    currency: string;
  }) {
    await this.requireDedicatedSku(input.siteId, input.skuId);
    return prisma.sku_price_overrides.upsert({
      where: {
        siteId_skuId_durationDays_minQty: {
          siteId: input.siteId,
          skuId: input.skuId,
          durationDays: input.durationDays,
          minQty: input.minQty,
        },
      },
      create: { ...input, unitPrice: new Decimal(input.unitPrice) },
      update: { unitPrice: new Decimal(input.unitPrice), currency: input.currency },
    });
  }

  async upsertDedicatedSkuTemplateRule(input: {
    siteId: string;
    templateId: string;
    skuId: string;
    durationDays: number;
    minQty: number;
    unitPrice: string;
    currency: string;
  }) {
    const template = await prisma.price_templates.findFirst({ where: { id: input.templateId, siteId: input.siteId, tenantId: null } });
    if (!template) throw new AppError(ErrorCode.NOT_FOUND, 'price_template_not_found', 404);
    await this.requireDedicatedSku(input.siteId, input.skuId);
    return prisma.sku_price_rules.upsert({
      where: {
        siteId_templateId_skuId_durationDays_minQty: {
          siteId: input.siteId,
          templateId: input.templateId,
          skuId: input.skuId,
          durationDays: input.durationDays,
          minQty: input.minQty,
        },
      },
      create: { ...input, unitPrice: new Decimal(input.unitPrice) },
      update: { unitPrice: new Decimal(input.unitPrice), currency: input.currency },
    });
  }

  async upsertUserDedicatedSkuOverride(input: {
    siteId: string;
    tenantId: string;
    userId: string;
    skuId: string;
    durationDays: number;
    minQty: number;
    unitPrice: string;
    currency: string;
  }) {
    await this.requireDedicatedSku(input.siteId, input.skuId);
    const user = await prisma.users.findFirst({ where: { id: input.userId, siteId: input.siteId, tenantId: input.tenantId }, select: { id: true } });
    if (!user) throw new AppError(ErrorCode.NOT_FOUND, 'user_not_found', 404);
    return prisma.user_sku_price_overrides.upsert({
      where: {
        siteId_userId_skuId_durationDays_minQty: {
          siteId: input.siteId,
          userId: input.userId,
          skuId: input.skuId,
          durationDays: input.durationDays,
          minQty: input.minQty,
        },
      },
      create: { ...input, unitPrice: new Decimal(input.unitPrice) },
      update: { unitPrice: new Decimal(input.unitPrice), currency: input.currency },
    });
  }

  private async requireDedicatedSku(siteId: string, skuId: string) {
    const sku = await prisma.service_skus.findFirst({
      where: { id: skuId, siteId, isActive: true, isVisible: true },
      select: { id: true, capabilities: true },
    });
    if (!sku || !isDedicatedLineCapabilities(sku.capabilities)) {
      throw new AppError(ErrorCode.NOT_FOUND, 'dedicated_sku_not_found', 404);
    }
    return sku;
  }

  async getPriceForUser(
    siteId: string,
    userId: string,
    resourceId: string,
    durationDays: number,
    quantity: number,
    currency: string,
  ): Promise<PriceResult | null> {
    const priceScopeIds = await resolvePricingResourceIds(siteId, resourceId);
    // 1. user_resource_price_overrides
    const userOverrides = await prisma.user_resource_price_overrides.findMany({
      where: { siteId, userId, resourceId: { in: priceScopeIds }, durationDays },
    });
    const userOverride = firstPriceInScope(userOverrides, priceScopeIds);

    // 2. user_price_bindings -> price_rules
    const binding = await prisma.user_price_bindings.findUnique({
      where: { siteId_userId: { siteId, userId } },
    });
    let userTemplateRule: Prisma.price_rulesGetPayload<Record<string, never>> | null = null;
    if (binding) {
      const userTemplateRules = await prisma.price_rules.findMany({
        where: {
          siteId,
          templateId: binding.templateId,
          resourceId: { in: priceScopeIds },
          durationDays,
          minQty: { lte: quantity },
        },
        orderBy: { minQty: 'desc' },
      });
      userTemplateRule = firstPriceInScope(userTemplateRules, priceScopeIds);
    }

    const user = await prisma.users.findFirst({
      where: { id: userId, siteId },
      select: { tenantId: true },
    });
    let tenantDefaultRule: Prisma.price_rulesGetPayload<Record<string, never>> | null = null;
    if (user) {
      const tenantDefaultTemplate = await prisma.price_templates.findFirst({
        where: { siteId, tenantId: user.tenantId, isDefault: true },
        select: { id: true },
      });
      if (tenantDefaultTemplate) {
        const tenantDefaultRules = await prisma.price_rules.findMany({
          where: {
            siteId,
            templateId: tenantDefaultTemplate.id,
            resourceId: { in: priceScopeIds },
            durationDays,
            minQty: { lte: quantity },
          },
          orderBy: { minQty: 'desc' },
        });
        tenantDefaultRule = firstPriceInScope(tenantDefaultRules, priceScopeIds);
      }
    }

    // 3. price_overrides
    const overrides = await prisma.price_overrides.findMany({
      where: { siteId, resourceId: { in: priceScopeIds }, durationDays },
    });
    const override = firstPriceInScope(overrides, priceScopeIds);

    // 4. site-global default price_template -> price_rules
    const defaultTemplate = await prisma.price_templates.findFirst({
      where: { siteId, tenantId: null, isDefault: true },
    });
    let defaultRule: Prisma.price_rulesGetPayload<Record<string, never>> | null = null;
    if (defaultTemplate) {
      const defaultRules = await prisma.price_rules.findMany({
        where: {
          siteId,
          templateId: defaultTemplate.id,
          resourceId: { in: priceScopeIds },
          durationDays,
          minQty: { lte: quantity },
        },
        orderBy: { minQty: 'desc' },
      });
      defaultRule = firstPriceInScope(defaultRules, priceScopeIds);
    }

    const candidate = selectPriceCandidate(
      [
        toCandidateSet(userOverride, 'USER_OVERRIDE'),
        toCandidateSet(userTemplateRule, 'USER_TEMPLATE'),
        toCandidateSet(tenantDefaultRule, 'TENANT_DEFAULT_TEMPLATE'),
        toCandidateSet(override, 'RESOURCE_OVERRIDE'),
        toCandidateSet(defaultRule, 'DEFAULT_TEMPLATE'),
      ],
      currency,
    );
    if (candidate === 'CURRENCY_MISMATCH') {
      throw new AppError(ErrorCode.CURRENCY_NOT_SUPPORTED, 'currency_not_supported', 422);
    }
    return candidate;
  }

  async createTemplate(data: CreateTemplateInput) {
    if (data.isDefault) {
      return prisma.$transaction(async (tx) => {
        await tx.price_templates.updateMany({
          where: { siteId: data.siteId, tenantId: null, isDefault: true },
          data: { isDefault: false },
        });
        return tx.price_templates.create({ data });
      });
    }
    return prisma.price_templates.create({ data });
  }

  async listTemplates(siteId: string, query: PageQueryDto = {}): Promise<PageResult<PriceTemplateListItem>> {
    const page = parsePositiveInteger(query.page, 1, 'page');
    const pageSize = parsePositiveInteger(query.pageSize, 20, 'pageSize', 20);
    const where: Prisma.price_templatesWhereInput = { siteId, tenantId: null };
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.price_templates.count({ where }),
      prisma.price_templates.findMany({
        where,
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          price_rules: {
            orderBy: [{ durationDays: 'asc' }, { createdAt: 'asc' }],
            include: {
              resource: { select: { id: true, code: true, name: true } },
            },
          },
        },
      }),
    ]);

    return { page, pageSize, total, items };
  }

  async upsertRules(templateId: string, siteId: string, rules: Array<Omit<UpsertPriceRuleInput, 'siteId' | 'templateId'>>) {
    const template = await prisma.price_templates.findFirst({ where: { id: templateId, siteId } });
    if (!template) throw new AppError(ErrorCode.NOT_FOUND, 'price_template_not_found', 404);
    return prisma.$transaction(
      rules.map((rule) =>
        prisma.price_rules.upsert({
          where: {
            siteId_templateId_resourceId_durationDays: {
              siteId,
              templateId,
              resourceId: rule.resourceId,
              durationDays: rule.durationDays,
            },
          },
          create: {
            siteId,
            templateId,
            resourceId: rule.resourceId,
            durationDays: rule.durationDays,
            unitPrice: new Decimal(rule.unitPrice),
            currency: rule.currency,
            minQty: rule.minQty ?? 1,
          },
          update: {
            unitPrice: new Decimal(rule.unitPrice),
            currency: rule.currency,
            minQty: rule.minQty ?? 1,
          },
        }),
      ),
    );
  }

  async upsertOverride(data: { siteId: string; resourceId: string; durationDays: number; unitPrice: string; currency: string }) {
    const resource = await prisma.platform_resources.findFirst({
      where: { id: data.resourceId, siteId: data.siteId },
      select: { id: true, status: true, isVisible: true, isSaleable: true, unsaleableReason: true },
    });
    if (!resource) throw new AppError(ErrorCode.NOT_FOUND, 'resource_not_found', 404);

    return prisma.$transaction(async (tx) => {
      const override = await tx.price_overrides.upsert({
        where: { siteId_resourceId_durationDays: { siteId: data.siteId, resourceId: data.resourceId, durationDays: data.durationDays } },
        create: { ...data, unitPrice: new Decimal(data.unitPrice) },
        update: { unitPrice: new Decimal(data.unitPrice), currency: data.currency },
      });
      if (
        resource.status === 'ACTIVE'
        && resource.isVisible
        && !resource.isSaleable
        && PRICE_MISSING_REASONS.has(resource.unsaleableReason ?? '')
      ) {
        await tx.platform_resources.update({
          where: { id: resource.id },
          data: {
            isVisible: true,
            isSaleable: true,
            unsaleableReason: null,
          },
        });
      }
      return override;
    });
  }

  async replaceOverridesForResources(data: {
    siteId: string;
    resourceIds: string[];
    durationDays: number;
    unitPrice: string;
    currency: string;
  }): Promise<{ updated: number; durationDays: number; currency: string }> {
    const uniqueResourceIds = [...new Set(data.resourceIds)];
    if (uniqueResourceIds.length === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'price_resources_missing', 400);
    }
    const chunks = chunk(uniqueResourceIds, 500);
    await prisma.$transaction(async (tx) => {
      for (const resourceIds of chunks) {
        await tx.price_overrides.deleteMany({
          where: {
            siteId: data.siteId,
            durationDays: data.durationDays,
            resourceId: { in: resourceIds },
          },
        });
        await tx.price_overrides.createMany({
          data: resourceIds.map((resourceId) => ({
            siteId: data.siteId,
            resourceId,
            durationDays: data.durationDays,
            unitPrice: new Decimal(data.unitPrice),
            currency: data.currency,
          })),
        });
      }
    });
    return { updated: uniqueResourceIds.length, durationDays: data.durationDays, currency: data.currency };
  }

  upsertUserOverride(data: { siteId: string; tenantId: string; userId: string; resourceId: string; durationDays: number; unitPrice: string; currency: string }) {
    return prisma.user_resource_price_overrides.upsert({
      where: { siteId_userId_resourceId_durationDays: { siteId: data.siteId, userId: data.userId, resourceId: data.resourceId, durationDays: data.durationDays } },
      create: { ...data, unitPrice: new Decimal(data.unitPrice) },
      update: { unitPrice: new Decimal(data.unitPrice), currency: data.currency },
    });
  }

  bindUserTemplate(data: { siteId: string; tenantId: string; userId: string; templateId: string }) {
    return prisma.user_price_bindings.upsert({
      where: { siteId_userId: { siteId: data.siteId, userId: data.userId } },
      create: data,
      update: { templateId: data.templateId },
    });
  }

  async listMatrixSummary(siteId: string, query: PricingMatrixSummaryQuery = {}): Promise<PricingMatrixSummaryItem[]> {
    const durationDays = parsePositiveInteger(query.durationDays, 30, 'durationDays');
    const currency = query.currency || undefined;
    const baseWhere = configurableMatrixWhere(siteId, query.providerCode);
    appendWhereAnd(baseWhere, await buildCurrentResourceAccountWhere(siteId, {
      tenantId: query.tenantId,
      providerCode: query.providerCode,
    }));

    const groups = await prisma.platform_resources.groupBy({
      by: ['providerCode'],
      where: baseWhere,
      _count: { _all: true },
      orderBy: { providerCode: 'asc' },
    });
    const providerCodes = query.providerCode ? [query.providerCode] : groups.map((group) => group.providerCode);
    const totalByProvider = new Map(groups.map((group) => [group.providerCode, group._count._all]));

    return Promise.all(providerCodes.map(async (providerCode) => {
      const providerWhere: Prisma.platform_resourcesWhereInput = { ...baseWhere, providerCode };
      const priceCurrencyWhere = currency ? { currency } : {};
      const [enabled, synced, priced] = await Promise.all([
        prisma.platform_resources.count({
          where: {
            ...providerWhere,
            status: 'ACTIVE',
            isVisible: true,
            isSaleable: true,
          },
        }),
        prisma.platform_resources.count({
          where: {
            ...providerWhere,
            inventory_snapshots: { some: { siteId } },
          },
        }),
        prisma.platform_resources.count({
          where: {
            ...providerWhere,
            OR: [
              {
                price_overrides: {
                  some: { siteId, durationDays, ...priceCurrencyWhere },
                },
              },
              {
                price_rules: {
                  some: {
                    siteId,
                    durationDays,
                    minQty: { lte: 1 },
                    ...priceCurrencyWhere,
                    template: { tenantId: null, isDefault: true },
                  },
                },
              },
            ],
          },
        }),
      ]);

      return {
        providerCode,
        total: totalByProvider.get(providerCode) ?? 0,
        enabled,
        synced,
        priced,
      };
    }));
  }

  async listMatrix(siteId: string, query: PricingMatrixQuery = {}): Promise<PageResult<PricingMatrixItem>> {
    const page = parsePositiveInteger(query.page, 1, 'page');
    const pageSize = parsePositiveInteger(
      query.pageSize,
      PRICING_MATRIX_DEFAULT_PAGE_SIZE,
      'pageSize',
      PRICING_MATRIX_MAX_PAGE_SIZE,
    );
    const durationDays = parsePositiveInteger(query.durationDays, 30, 'durationDays');
    const currency = query.currency || undefined;
    const includeTotal = !isFalsey(query.includeTotal);
    const withInventory = !isFalsey(query.withInventory);
    const where: Prisma.platform_resourcesWhereInput = { siteId };

    if (query.providerCode) where.providerCode = query.providerCode;
    if (isTruthy(query.configurableOnly)) {
      where.type = { not: 'COUNTRY' };
      where.status = { not: 'DISABLED' };
      appendWhereAnd(where, await buildCurrentResourceAccountWhere(siteId, {
        tenantId: query.tenantId,
        providerCode: query.providerCode,
      }));
    }
    if (query.ipType) {
      if (!isIpType(query.ipType)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'ip_type_invalid', 400);
      }
      where.ipType = query.ipType;
    }
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
        { displayName: { contains: query.search, mode: 'insensitive' } },
        { providerCode: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const resourceRows = await prisma.platform_resources.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      ...(withInventory
        ? { include: { inventory_snapshots: { orderBy: { capturedAt: 'desc' }, take: 1 } } }
        : {}),
    }) as MatrixResourceRow[];
    const resourceTotal = includeTotal
      ? await prisma.platform_resources.count({ where })
      : ((page - 1) * pageSize) + resourceRows.length;

    const resourceIds = resourceRows.map((row) => row.id);
    const [overrides, defaultTemplate] = await Promise.all([
      resourceIds.length === 0
        ? Promise.resolve([])
        : prisma.price_overrides.findMany({ where: { siteId, resourceId: { in: resourceIds }, durationDays } }),
      prisma.price_templates.findFirst({ where: { siteId, tenantId: null, isDefault: true }, select: { id: true } }),
    ]);
    const rules = defaultTemplate && resourceIds.length > 0
      ? await prisma.price_rules.findMany({
        where: {
          siteId,
          templateId: defaultTemplate.id,
          resourceId: { in: resourceIds },
          durationDays,
          minQty: { lte: 1 },
        },
        orderBy: { minQty: 'desc' },
      })
      : [];

    const overrideByResource = new Map(overrides.map((item) => [item.resourceId, item]));
    const ruleByResource = new Map<string, Prisma.price_rulesGetPayload<Record<string, never>>>();
    for (const rule of rules) {
      if (!ruleByResource.has(rule.resourceId)) ruleByResource.set(rule.resourceId, rule);
    }

    const allItems = resourceRows.map((resource) => toMatrixItem(
      resource,
      overrideByResource.get(resource.id) ?? null,
      ruleByResource.get(resource.id) ?? null,
      currency,
    ));
    const items = applyStockState(allItems, query.stockState);

    return { page, pageSize, total: query.stockState ? items.length : resourceTotal, items };
  }
}

function configurableMatrixWhere(siteId: string, providerCode?: string): Prisma.platform_resourcesWhereInput {
  return {
    siteId,
    ...(providerCode ? { providerCode } : {}),
    type: { not: 'COUNTRY' },
    status: { not: 'DISABLED' },
  };
}

function appendWhereAnd(where: Prisma.platform_resourcesWhereInput, condition: Prisma.platform_resourcesWhereInput): void {
  where.AND = Array.isArray(where.AND) ? [...where.AND, condition] : [condition];
}

type PriceRow =
  | Prisma.user_resource_price_overridesGetPayload<Record<string, never>>
  | Prisma.price_rulesGetPayload<Record<string, never>>
  | Prisma.price_overridesGetPayload<Record<string, never>>
  | null;

const PRICE_MISSING_REASONS = new Set(['price_missing', 'no_price_rule', 'not_configured']);

function toCandidateSet(row: PriceRow, source: PriceResult['source']) {
  const candidates: PriceCandidate[] = row
    ? [{ unitPrice: row.unitPrice.toString(), currency: row.currency, source }]
    : [];
  return { candidates, hasCurrencyMismatch: candidates.length > 0 };
}

function firstPriceInScope<T extends { resourceId: string }>(rows: T[], resourceIds: string[]): T | null {
  for (const resourceId of resourceIds) {
    const row = rows.find((item) => item.resourceId === resourceId);
    if (row) return row;
  }
  return null;
}

function isDedicatedLineCapabilities(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).delivery === 'dedicated-line');
}

function toDedicatedSkuPriceRule(row: {
  id: string;
  durationDays: number;
  minQty: number;
  unitPrice: Decimal;
  currency: string;
}) {
  return {
    id: row.id,
    durationDays: row.durationDays,
    minQty: row.minQty,
    unitPrice: row.unitPrice.toString(),
    currency: row.currency,
  };
}

function parsePositiveInteger(value: string | number | undefined, fallback: number, field: string, max?: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, `${field}_invalid`, 400);
  }
  return max === undefined ? parsed : Math.min(parsed, max);
}

function toMatrixItem(
  resource: MatrixResourceRow,
  override: Prisma.price_overridesGetPayload<Record<string, never>> | null,
  defaultRule: Prisma.price_rulesGetPayload<Record<string, never>> | null,
  currency?: string,
): PricingMatrixItem {
  const latest = resource.inventory_snapshots?.[0];
  const effective = override ?? defaultRule;
  const currencyMatchedEffective = effective && (!currency || effective.currency === currency) ? effective : null;
  return {
    resourceId: resource.id,
    code: resource.code,
    name: resource.name,
    displayName: resource.displayName,
    providerCode: resource.providerCode,
    ipType: resource.ipType,
    protocol: resource.protocol,
    status: resource.status,
    isSaleable: resource.isSaleable,
    stock: latest?.stock ?? null,
    inventoryCapturedAt: latest?.capturedAt ?? null,
    inventoryIsStale: latest ? isInventorySnapshotStale({ ...latest, providerCode: resource.providerCode }) : null,
    overridePrice: override && (!currency || override.currency === currency) ? override.unitPrice.toString() : null,
    effectivePrice: currencyMatchedEffective ? currencyMatchedEffective.unitPrice.toString() : null,
    currency: currencyMatchedEffective?.currency ?? override?.currency ?? defaultRule?.currency ?? currency ?? null,
    upstreamCost: resource.upstreamCost?.toString() ?? null,
    upstreamCostCurrency: resource.upstreamCostCurrency,
  };
}

function applyStockState(items: PricingMatrixItem[], stockState?: string): PricingMatrixItem[] {
  if (!stockState) return items;
  if (stockState === 'available') return items.filter((item) => (item.stock ?? 0) > 0);
  if (stockState === 'empty') return items.filter((item) => item.stock === 0);
  if (stockState === 'missing') return items.filter((item) => item.stock === null);
  throw new AppError(ErrorCode.VALIDATION_ERROR, 'stock_state_invalid', 400);
}

function isIpType(value: string): value is IpType {
  return value === IpType.NATIVE || value === IpType.BROADCAST || value === IpType.BOTH;
}

function isTruthy(value: string | boolean | undefined): boolean {
  return value === true || value === 'true' || value === '1';
}

function isFalsey(value: string | boolean | undefined): boolean {
  return value === false || value === 'false' || value === '0';
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
