import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { prisma, ResourceStatus, ResourceType } from '@ipeasy/db';
import { Prisma } from '@ipeasy/db/generated/client';
import { PageQueryDto, PageResult } from '../../common/pagination/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { isInventorySnapshotStale } from './domain';
import { getBaseStaticProxyPrice, resourceCountryCode } from '../pricing/base-price';
import { resolvePricingScopesForResources } from '../pricing/price-scopes';
import { getProviderResourceSaleability } from './provider-saleability-policy';
import { inventoryFreshnessTtlSeconds } from './inventory-freshness';
import {
  buildCurrentResourceAccountWhere,
  resolveCurrentResourceAccountIdsForProvider,
} from '../providers/current-resource-account-filter';

const PRICEABLE_CATALOG_MAX_PAGE_SIZE = 500;
const PRICEABLE_CATALOG_SELECTOR_PAGE_SIZE = 20;

export type ResourceListQuery = PageQueryDto & {
  type?: string;
  providerCode?: string;
  countryCode?: string;
  publicOnly?: boolean;
  userId?: string;
  tenantId?: string | null;
  durationDays?: string | number;
  currency?: string;
};

export type ResourceListItem = Omit<
  ResourceWithInventory,
  'inventory_snapshots' | 'resource_mappings' | 'upstreamCost' | 'upstreamCostCurrency'
> & {
  countryCode: string;
  upstreamResourceId: string | null;
  stock: number | null;
  inventoryCapturedAt: Date | null;
  inventoryIsStale: boolean | null;
  unitPrice: string | null;
  priceCurrency: string | null;
  costGroupKey?: string | null;
  upstreamCost?: string | null;
  upstreamCostCurrency?: string | null;
};

export type PublicResourceCountryItem = {
  countryCode: string;
  totalResources: number;
  availableStock: number;
};

export type PriceableCatalogCountrySummaryItem = {
  countryCode: string;
  totalResources: number;
  regionCount: number;
  pricedCount: number;
  costGroupCount: number;
};

export type PriceableCatalogCountrySummaryResult = PageResult<PriceableCatalogCountrySummaryItem> & {
  totalResources: number;
};

export type PriceableCatalogGroupItem = {
  key: string;
  countryCode: string;
  regionKey: string;
  costGroupKey: string;
  resourceCount: number;
  pricedCount: number;
  unitPrice: string | null;
  priceCurrency: string | null;
  upstreamCost: string | null;
  upstreamCostCurrency: string | null;
  autoSelect: boolean;
  sampleResource: ResourceListItem;
};

export type PriceableCatalogGroupResult = PageResult<PriceableCatalogGroupItem> & {
  countryCode: string;
  totalResources: number;
};

export type PriceableCatalogGroupSelector = {
  countryCode?: string;
  regionKey?: string;
  costGroupKey?: string;
  autoSelect?: boolean | string;
  tenantId?: string | null;
  providerCode?: string;
  durationDays?: string | number;
  currency?: string;
};

export type ResourceCoverageKey = {
  code: string;
  ipType: 'NATIVE' | 'BROADCAST' | 'BOTH';
};

type ResourceWithInventory = Prisma.platform_resourcesGetPayload<{
  select: {
    id: true;
    upstreamAccountId: true;
    parentId: true;
    type: true;
    code: true;
    name: true;
    displayName: true;
    providerCode: true;
    ipType: true;
    protocol: true;
    status: true;
    sortOrder: true;
    isVisible: true;
    isSaleable: true;
    unsaleableReason: true;
    upstreamCost: true;
    upstreamCostCurrency: true;
    inventory_snapshots: {
      select: {
        stock: true;
        capturedAt: true;
        freshnessTtlSeconds: true;
        isStale: true;
      };
      orderBy: { capturedAt: 'desc' };
      take: 1;
    };
    resource_mappings: {
      select: {
        upstreamAccountId: true;
        providerResourceId: true;
      };
      orderBy: { weight: 'desc' };
      take: 1;
    };
  };
}>;

type PriceableCatalogResource = Prisma.platform_resourcesGetPayload<{
  select: {
    id: true;
    upstreamAccountId: true;
    parentId: true;
    type: true;
    code: true;
    name: true;
    displayName: true;
    providerCode: true;
    ipType: true;
    protocol: true;
    status: true;
    sortOrder: true;
    isVisible: true;
    isSaleable: true;
    unsaleableReason: true;
    upstreamCost: true;
    upstreamCostCurrency: true;
    resource_mappings: {
      select: {
        upstreamAccountId: true;
        providerResourceId: true;
      };
      orderBy: { weight: 'desc' };
      take: 1;
    };
  };
}>;

type InternalPriceableCatalogGroup = {
  key: string;
  countryCode: string;
  regionKey: string;
  costGroupKey: string;
  resourceIds: string[];
  sampleResource: PriceableCatalogResource;
  autoSelect: boolean;
};

@Injectable()
export class ResourcesRepository {
  findById(id: string) {
    return prisma.platform_resources.findUnique({ where: { id } });
  }

  findByIdInSite(id: string, siteId: string) {
    return prisma.platform_resources.findFirst({ where: { id, siteId } });
  }

  async list(siteId: string, query: ResourceListQuery = {}): Promise<PageResult<ResourceListItem>> {
    const page = parsePositiveInteger(query.page, 1, 'page');
    const pageSize = parsePositiveInteger(query.pageSize, 20, 'pageSize', 20);
    if (query.publicOnly) {
      return this.listPublicSaleable(siteId, { ...query, page, pageSize });
    }
    const where: Prisma.platform_resourcesWhereInput = { siteId };
    if (query.status) {
      if (!isResourceStatus(query.status)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'resource_status_invalid', 400);
      }
      where.status = query.status as ResourceStatus;
    }
    if (query.type) {
      if (!isResourceType(query.type)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'resource_type_invalid', 400);
      }
      where.type = query.type as ResourceType;
    }
    if (query.providerCode) where.providerCode = query.providerCode;
    appendWhereAnd(where, await buildCurrentResourceAccountWhere(siteId, {
      tenantId: query.tenantId,
      providerCode: query.providerCode,
    }));
    const searchConditions = buildResourceSearchConditions(query.search);
    if (searchConditions.length > 0) where.OR = searchConditions;

    const [total, rows] = await Promise.all([
      prisma.platform_resources.count({ where }),
      prisma.platform_resources.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: {
          inventory_snapshots: {
            orderBy: { capturedAt: 'desc' },
            take: 1,
          },
          resource_mappings: {
            orderBy: { weight: 'desc' },
            take: 1,
          },
        },
      }),
    ]);
    const priceByResource = await this.getAdminOverridePriceMap(
      siteId,
      rows.map((row) => row.id),
      parsePositiveInteger(query.durationDays, 30, 'durationDays'),
      query.currency,
    );

    return {
      page,
      pageSize,
      total,
      items: rows.map((row) => toResourceListItem(row, priceByResource.get(row.id) ?? null, true)),
    };
  }

  async listPriceableCatalog(siteId: string, query: ResourceListQuery = {}): Promise<PageResult<ResourceListItem>> {
    const page = parsePositiveInteger(query.page, 1, 'page');
    const pageSize = parsePositiveInteger(query.pageSize, 20, 'pageSize', PRICEABLE_CATALOG_MAX_PAGE_SIZE);
    const durationDays = parsePositiveInteger(query.durationDays, 30, 'durationDays');
    const where = await this.buildPriceableCatalogWhere(siteId, query);
    const [total, rows] = await Promise.all([
      prisma.platform_resources.count({ where }),
      prisma.platform_resources.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          upstreamAccountId: true,
          parentId: true,
          type: true,
          code: true,
          name: true,
          displayName: true,
          providerCode: true,
          ipType: true,
          protocol: true,
          status: true,
          sortOrder: true,
          isVisible: true,
          isSaleable: true,
          unsaleableReason: true,
          upstreamCost: true,
          upstreamCostCurrency: true,
          resource_mappings: {
            select: {
              upstreamAccountId: true,
              providerResourceId: true,
            },
            orderBy: { weight: 'desc' },
            take: 1,
          },
        },
      }),
    ]);
    const priceByResource = await this.getAdminOverridePriceMap(
      siteId,
      rows.map((row) => row.id),
      durationDays,
      query.currency,
    );
    const items = rows.map((row) => toPriceableCatalogItem(row, priceByResource.get(row.id) ?? null));
    return {
      page,
      pageSize,
      total,
      items,
    };
  }

  async listPriceableCatalogSummary(
    siteId: string,
    query: ResourceListQuery = {},
  ): Promise<PriceableCatalogCountrySummaryResult> {
    const page = parsePositiveInteger(query.page, 1, 'page');
    const pageSize = parsePositiveInteger(query.pageSize, PRICEABLE_CATALOG_SELECTOR_PAGE_SIZE, 'pageSize', PRICEABLE_CATALOG_SELECTOR_PAGE_SIZE);
    const durationDays = parsePositiveInteger(query.durationDays, 30, 'durationDays');
    const where = await this.buildPriceableCatalogWhere(siteId, query);
    const rows = await prisma.platform_resources.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        displayName: true,
        upstreamCost: true,
        upstreamCostCurrency: true,
        resource_mappings: {
          select: {
            providerResourceId: true,
          },
          orderBy: { weight: 'desc' },
          take: 1,
        },
      },
    });
    const priceByResource = await this.getAdminOverridePriceMap(
      siteId,
      rows.map((row) => row.id),
      durationDays,
      query.currency,
    );
    const summaryByCountry = new Map<string, {
      countryCode: string;
      totalResources: number;
      pricedCount: number;
      regionKeys: Set<string>;
      costGroupKeys: Set<string>;
    }>();

    for (const row of rows) {
      const countryCode = resourceCountryCode(row.code);
      const current = summaryByCountry.get(countryCode) ?? {
        countryCode,
        totalResources: 0,
        pricedCount: 0,
        regionKeys: new Set<string>(),
        costGroupKeys: new Set<string>(),
      };
      current.totalResources += 1;
      if (priceByResource.has(row.id)) current.pricedCount += 1;
      current.regionKeys.add(getPriceableCatalogRegionKey(row));
      current.costGroupKeys.add(toPublicCostGroupKey(row.upstreamCost, row.upstreamCostCurrency));
      summaryByCountry.set(countryCode, current);
    }

    const allItems = [...summaryByCountry.values()]
      .map((item) => ({
        countryCode: item.countryCode,
        totalResources: item.totalResources,
        regionCount: shouldCollapseCountrySummaryToAutoSelect(item) ? 1 : item.regionKeys.size,
        pricedCount: item.pricedCount,
        costGroupCount: item.costGroupKeys.size,
      }))
      .sort((left, right) => left.countryCode.localeCompare(right.countryCode));
    const start = (page - 1) * pageSize;
    return {
      page,
      pageSize,
      total: allItems.length,
      totalResources: rows.length,
      items: allItems.slice(start, start + pageSize),
    };
  }

  async listPriceableCatalogGroups(
    siteId: string,
    query: ResourceListQuery = {},
  ): Promise<PriceableCatalogGroupResult> {
    const countryCode = normalizeCountryCodeOrThrow(query.countryCode);
    const page = parsePositiveInteger(query.page, 1, 'page');
    const pageSize = parsePositiveInteger(query.pageSize, PRICEABLE_CATALOG_SELECTOR_PAGE_SIZE, 'pageSize', PRICEABLE_CATALOG_SELECTOR_PAGE_SIZE);
    const durationDays = parsePositiveInteger(query.durationDays, 30, 'durationDays');
    const rows = await this.findPriceableCatalogRows(siteId, { ...query, countryCode });
    const priceByResource = await this.getAdminOverridePriceMap(
      siteId,
      rows.map((row) => row.id),
      durationDays,
      query.currency,
    );
    const groups = buildInternalPriceableCatalogGroups(rows)
      .map((group) => toPriceableCatalogGroupItem(group, priceByResource))
      .sort(comparePriceableCatalogGroups);
    const start = (page - 1) * pageSize;
    return {
      countryCode,
      page,
      pageSize,
      total: groups.length,
      totalResources: rows.length,
      items: groups.slice(start, start + pageSize),
    };
  }

  async findPriceableCatalogGroupResourceIds(
    siteId: string,
    selector: PriceableCatalogGroupSelector,
  ): Promise<string[]> {
    const countryCode = normalizeCountryCodeOrThrow(selector.countryCode);
    const rows = await this.findPriceableCatalogRows(siteId, { ...selector, countryCode });
    const groups = buildInternalPriceableCatalogGroups(rows);
    const autoSelect = isTruthy(selector.autoSelect);
    const matched = groups.find((group) => {
      if (autoSelect) return group.autoSelect && group.countryCode === countryCode;
      return (
        group.countryCode === countryCode
        && group.regionKey === selector.regionKey
        && group.costGroupKey === selector.costGroupKey
      );
    });
    return matched?.resourceIds ?? [];
  }

  async updatePriceableCatalogGroupSaleability(
    siteId: string,
    selector: PriceableCatalogGroupSelector,
    saleable: boolean,
  ): Promise<{ updated: number; resourceIds: string[] }> {
    const resourceIds = await this.findPriceableCatalogGroupResourceIds(siteId, selector);
    if (resourceIds.length === 0) {
      throw new AppError(ErrorCode.NOT_FOUND, 'resource_group_not_found', 404);
    }

    const result = await prisma.platform_resources.updateMany({
      where: {
        siteId,
        id: { in: resourceIds },
      },
      data: saleable
        ? {
            status: 'ACTIVE',
            isVisible: true,
            isSaleable: true,
            unsaleableReason: null,
          }
        : {
            status: 'HIDDEN',
            isVisible: false,
            isSaleable: false,
            unsaleableReason: 'provider_sale_disabled',
          },
    });
    return { updated: result.count, resourceIds };
  }

  async listPublicCountries(siteId: string, query: ResourceListQuery = {}): Promise<{ items: PublicResourceCountryItem[] }> {
    const where: Prisma.platform_resourcesWhereInput = {
      siteId,
      status: 'ACTIVE',
      isVisible: true,
      isSaleable: true,
    };
    applyConcreteSaleableResourceFilter(where, siteId);
    appendWhereAnd(where, await buildCurrentResourceAccountWhere(siteId, {
      tenantId: query.tenantId,
      providerCode: query.providerCode,
    }));
    if (query.providerCode) where.providerCode = query.providerCode;
    applyCountryCodeFilter(where, query.countryCode);
    const searchConditions = buildResourceSearchConditions(query.search);
    if (searchConditions.length > 0) where.OR = searchConditions;
    parsePositiveInteger(query.durationDays, 30, 'durationDays');

    const rows = await prisma.platform_resources.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        code: true,
        providerCode: true,
        ipType: true,
      },
    });
    const countries = new Map<string, PublicResourceCountryItem>();
    for (const row of rows) {
      const countryCode = resourceCountryCode(row.code);
      const current = countries.get(countryCode) ?? { countryCode, totalResources: 0, availableStock: 0 };
      current.totalResources += 1;
      countries.set(countryCode, current);
    }
    return { items: [...countries.values()].sort((left, right) => left.countryCode.localeCompare(right.countryCode)) };
  }

  private async buildPriceableCatalogWhere(
    siteId: string,
    query: Pick<ResourceListQuery, 'tenantId' | 'providerCode' | 'countryCode' | 'search'> = {},
  ): Promise<Prisma.platform_resourcesWhereInput> {
    const where: Prisma.platform_resourcesWhereInput = {
      siteId,
      status: 'ACTIVE',
      isVisible: true,
      isSaleable: true,
    };
    applyConcreteSaleableResourceFilter(where, siteId);
    if (query.providerCode) where.providerCode = query.providerCode;
    appendWhereAnd(where, await buildCurrentResourceAccountWhere(siteId, {
      tenantId: query.tenantId,
      providerCode: query.providerCode,
    }));
    applyCountryCodeFilter(where, query.countryCode);
    const searchConditions = buildResourceSearchConditions(query.search);
    if (searchConditions.length > 0) where.OR = searchConditions;
    return where;
  }

  private async findPriceableCatalogRows(
    siteId: string,
    query: Pick<ResourceListQuery, 'tenantId' | 'providerCode' | 'countryCode' | 'search'> = {},
  ): Promise<PriceableCatalogResource[]> {
    return prisma.platform_resources.findMany({
      where: await this.buildPriceableCatalogWhere(siteId, query),
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        upstreamAccountId: true,
        parentId: true,
        type: true,
        code: true,
        name: true,
        displayName: true,
        providerCode: true,
        ipType: true,
        protocol: true,
        status: true,
        sortOrder: true,
        isVisible: true,
        isSaleable: true,
        unsaleableReason: true,
        upstreamCost: true,
        upstreamCostCurrency: true,
        resource_mappings: {
          select: {
            upstreamAccountId: true,
            providerResourceId: true,
          },
          orderBy: { weight: 'desc' },
          take: 1,
        },
      },
    });
  }

  create(data: Prisma.platform_resourcesUncheckedCreateInput) {
    return prisma.platform_resources.create({ data });
  }

  update(id: string, _siteId: string, data: Prisma.platform_resourcesUncheckedUpdateInput) {
    return prisma.platform_resources.update({ where: { id }, data });
  }

  findSyncedResource(
    siteId: string,
    providerCode: string,
    upstreamAccountId: string | null | undefined,
    code: string,
    ipType: 'NATIVE' | 'BROADCAST',
  ) {
    return prisma.platform_resources.findFirst({
      where: {
        siteId,
        providerCode,
        upstreamAccountId: upstreamAccountId ?? null,
        code,
        ipType,
      },
    });
  }

  async hasProviderMapping(siteId: string, resourceId: string, providerCode: string): Promise<boolean> {
    const mapping = await prisma.resource_mappings.findFirst({
      where: {
        siteId,
        resourceId,
        providerCode,
      },
      select: { id: true },
    });
    return Boolean(mapping);
  }

  async upsertSyncedResource(data: {
    siteId: string;
    providerCode: string;
    upstreamAccountId?: string | null;
    code: string;
    name: string;
    displayName?: string | null;
    type?: 'COUNTRY' | 'REGION' | 'ZONE';
    parentId?: string | null;
    ipType: 'NATIVE' | 'BROADCAST';
    protocol: 'HTTP' | 'SOCKS5' | 'BOTH';
    providerResourceId?: string | null;
    upstreamCost?: string | number | null;
    upstreamCostCurrency?: string | null;
    saleabilityOverride?: {
      status: 'ACTIVE' | 'HIDDEN' | 'DISABLED';
      isVisible: boolean;
      isSaleable: boolean;
      unsaleableReason: string | null;
    };
  }) {
    const cost = normalizeUpstreamCost(data.upstreamCost);
    const saleability = getProviderResourceSaleability(data);
    const saleabilityData = data.saleabilityOverride ?? (saleability.managed
      ? {
          status: saleability.saleable ? 'ACTIVE' as const : 'HIDDEN' as const,
          isVisible: saleability.saleable,
          isSaleable: saleability.saleable,
          unsaleableReason: saleability.reason,
        }
      : { status: 'ACTIVE' as const, isVisible: true, isSaleable: true, unsaleableReason: null });
    const createData = {
      siteId: data.siteId,
      upstreamAccountId: data.upstreamAccountId ?? null,
      parentId: data.parentId ?? undefined,
      providerCode: data.providerCode,
      code: data.code,
      name: data.name,
      displayName: data.displayName ?? data.name,
      type: data.type ?? 'COUNTRY',
      ipType: data.ipType,
      protocol: data.protocol,
      ...saleabilityData,
      upstreamCost: cost === null ? null : new Prisma.Decimal(cost),
      upstreamCostCurrency: cost === null ? null : data.upstreamCostCurrency ?? 'CNY',
    };
    const updateData = {
      name: data.name,
      displayName: data.displayName ?? data.name,
      ...(data.parentId !== undefined ? { parentId: data.parentId } : {}),
      ...(data.type ? { type: data.type } : {}),
      protocol: data.protocol,
      ...saleabilityData,
      upstreamCost: cost === null ? null : new Prisma.Decimal(cost),
      upstreamCostCurrency: cost === null ? null : data.upstreamCostCurrency ?? 'CNY',
    };

    if (!data.upstreamAccountId) {
      const existing = await prisma.platform_resources.findFirst({
        where: {
          siteId: data.siteId,
          providerCode: data.providerCode,
          upstreamAccountId: null,
          code: data.code,
          ipType: data.ipType,
        },
        select: { id: true },
      });
      return existing
        ? prisma.platform_resources.update({ where: { id: existing.id }, data: updateData })
        : prisma.platform_resources.create({ data: createData });
    }

    return prisma.platform_resources.upsert({
      where: {
        siteId_providerCode_upstreamAccountId_code_ipType: {
          siteId: data.siteId,
          providerCode: data.providerCode,
          upstreamAccountId: data.upstreamAccountId,
          code: data.code,
          ipType: data.ipType,
        },
      },
      create: createData,
      update: updateData,
    });
  }

  disableResourcesOutsideCoverage(
    siteId: string,
    providerCode: string,
    upstreamAccountId: string | null | undefined,
    allowedResources: ResourceCoverageKey[],
  ) {
    const keepFilter = buildResourceCoverageKeepFilter(allowedResources);
    return prisma.platform_resources.updateMany({
      where: {
        siteId,
        providerCode,
        upstreamAccountId: upstreamAccountId ?? null,
        status: { not: 'DISABLED' },
        ...(keepFilter ? { NOT: keepFilter } : {}),
      },
      data: {
        status: 'DISABLED',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: 'provider_country_not_supported',
      },
    });
  }

  hideResourcesOutsideEnabledCountries(siteId: string, providerCode: string, allowedCodes: string[]) {
    return prisma.platform_resources.updateMany({
      where: {
        siteId,
        providerCode,
        code: { notIn: allowedCodes },
        status: { not: 'DISABLED' },
      },
      data: {
        status: 'HIDDEN',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: 'provider_country_disabled',
      },
    });
  }

  async findProviderAccountTenant(
    siteId: string,
    providerCode: string,
    upstreamAccountId: string,
  ): Promise<string | null | undefined> {
    if (providerCode === 'UPSTREAM_API') {
      const account = await prisma.upstream_api_accounts.findFirst({
        where: { id: upstreamAccountId, siteId },
        select: { tenantId: true },
      });
      return account ? account.tenantId : undefined;
    }
    const account = await prisma.provider_accounts.findFirst({
      where: { id: upstreamAccountId, siteId, providerCode },
      select: { tenantId: true },
    });
    return account ? account.tenantId : undefined;
  }

  hideResourcesOutsideCurrentSync(
    siteId: string,
    providerCode: string,
    upstreamAccountId: string | null | undefined,
    currentResources: ResourceCoverageKey[],
  ) {
    const keepFilter = buildResourceCoverageKeepFilter(currentResources);
    return prisma.platform_resources.updateMany({
      where: {
        siteId,
        providerCode,
        upstreamAccountId: upstreamAccountId ?? null,
        status: { not: 'DISABLED' },
        ...(keepFilter ? { NOT: keepFilter } : {}),
      },
      data: {
        status: 'HIDDEN',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: 'upstream_resource_not_returned',
      },
    });
  }

  async hideResourcesFromOtherUpstreamAccounts(
    siteId: string,
    providerCode: string,
    upstreamAccountId: string,
  ) {
    const currentAccountIds = await resolveCurrentResourceAccountIdsForProvider(siteId, providerCode);
    const keepAccountIds = [...new Set([...currentAccountIds, upstreamAccountId])];
    return prisma.platform_resources.updateMany({
      where: {
        siteId,
        providerCode,
        status: { not: 'DISABLED' },
        OR: [
          { upstreamAccountId: { notIn: keepAccountIds } },
          { upstreamAccountId: null },
        ],
      },
      data: {
        status: 'HIDDEN',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: 'upstream_resource_not_returned',
      },
    });
  }

  hideUpstreamAccountResources(
    siteId: string,
    providerCode: string,
    upstreamAccountId: string,
    reason: string,
  ) {
    return prisma.platform_resources.updateMany({
      where: {
        siteId,
        providerCode,
        status: { not: 'DISABLED' },
        OR: [
          { upstreamAccountId },
          { upstreamAccountId: null },
        ],
      },
      data: {
        status: 'HIDDEN',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: reason,
      },
    });
  }

  upsertInventorySnapshot(data: {
    siteId: string;
    resourceId: string;
    providerCode: string;
    upstreamAccountId?: string | null;
    stock: number;
    capturedAt: Date;
    freshnessTtlSeconds?: number;
  }) {
    return prisma.inventory_snapshots.create({
      data: {
        siteId: data.siteId,
        resourceId: data.resourceId,
        providerCode: data.providerCode,
        upstreamAccountId: data.upstreamAccountId ?? null,
        stock: data.stock,
        capturedAt: data.capturedAt,
        freshnessTtlSeconds: data.freshnessTtlSeconds ?? inventoryFreshnessTtlSeconds(data.providerCode),
        isStale: false,
      },
    });
  }

  async listInventory(resourceId: string, siteId?: string) {
    const snapshots = await prisma.inventory_snapshots.findMany({
      where: { resourceId, ...(siteId ? { siteId } : {}) },
      orderBy: { capturedAt: 'desc' },
    });
    return snapshots.map((s) => ({ ...s, isStale: isInventorySnapshotStale(s) }));
  }

  async getLatestInventory(resourceId: string, siteId: string, upstreamAccountId?: string | null) {
    const snapshot = await prisma.inventory_snapshots.findFirst({
      where: {
        resourceId,
        siteId,
        ...(upstreamAccountId !== undefined ? { upstreamAccountId } : {}),
      },
      orderBy: { capturedAt: 'desc' },
    });
    return snapshot ? { ...snapshot, isStale: isInventorySnapshotStale(snapshot) } : null;
  }

  async upsertMapping(data: {
    siteId: string;
    resourceId: string;
    providerCode: string;
    upstreamAccountId?: string | null;
    providerResourceId: string;
    weight?: number;
  }) {
    const createData = { ...data, upstreamAccountId: data.upstreamAccountId ?? null, weight: data.weight ?? 100 };
    const updateData = { providerResourceId: data.providerResourceId, weight: data.weight ?? 100 };

    if (!data.upstreamAccountId) {
      const existing = await prisma.resource_mappings.findFirst({
        where: {
          siteId: data.siteId,
          resourceId: data.resourceId,
          providerCode: data.providerCode,
          upstreamAccountId: null,
        },
        select: { id: true },
      });
      return existing
        ? prisma.resource_mappings.update({ where: { id: existing.id }, data: updateData })
        : prisma.resource_mappings.create({ data: createData });
    }

    return prisma.resource_mappings.upsert({
      where: {
        siteId_resourceId_providerCode_upstreamAccountId: {
          siteId: data.siteId,
          resourceId: data.resourceId,
          providerCode: data.providerCode,
          upstreamAccountId: data.upstreamAccountId,
        },
      },
      create: createData,
      update: updateData,
    });
  }

  private async listPublicSaleable(
    siteId: string,
    query: ResourceListQuery & { page: number; pageSize: number },
  ): Promise<PageResult<ResourceListItem>> {
    const durationDays = parsePositiveInteger(query.durationDays, 30, 'durationDays');
    const currency = query.currency || 'CNY';
    const where: Prisma.platform_resourcesWhereInput = {
      siteId,
      status: 'ACTIVE',
      isVisible: true,
      isSaleable: true,
    };
    applyConcreteSaleableResourceFilter(where, siteId);
    appendWhereAnd(where, await buildCurrentResourceAccountWhere(siteId, {
      tenantId: query.tenantId,
      providerCode: query.providerCode,
    }));
    if (query.type) {
      if (!isResourceType(query.type)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'resource_type_invalid', 400);
      }
      where.type = query.type as ResourceType;
    }
    if (query.providerCode) where.providerCode = query.providerCode;
    applyCountryCodeFilter(where, query.countryCode);
    const searchConditions = buildResourceSearchConditions(query.search);
    if (searchConditions.length > 0) where.OR = searchConditions;

    const [total, rows] = await Promise.all([
      prisma.platform_resources.count({ where }),
      prisma.platform_resources.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          upstreamAccountId: true,
          parentId: true,
        type: true,
        code: true,
        name: true,
        displayName: true,
        providerCode: true,
        ipType: true,
        protocol: true,
        status: true,
        sortOrder: true,
        isVisible: true,
        isSaleable: true,
        unsaleableReason: true,
        upstreamCost: true,
        upstreamCostCurrency: true,
        inventory_snapshots: {
          select: {
            stock: true,
            capturedAt: true,
            freshnessTtlSeconds: true,
            isStale: true,
          },
          orderBy: { capturedAt: 'desc' },
          take: 1,
        },
          resource_mappings: {
            select: {
              upstreamAccountId: true,
              providerResourceId: true,
            },
          orderBy: { weight: 'desc' },
          take: 1,
        },
      },
      }),
    ]);
    const priceByResource = await this.getPublicPriceMap(siteId, query.userId, rows, durationDays, currency);

    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      items: rows.map((row) => toResourceListItem(row, priceByResource.get(row.id) ?? null, false)),
    };
  }

  private async getPublicPriceMap(
    siteId: string,
    userId: string | undefined,
    resources: PriceableResource[],
    durationDays: number,
    currency: string,
  ): Promise<Map<string, ResourcePrice>> {
    const resourceIds = resources.map((resource) => resource.id);
    if (resourceIds.length === 0) return new Map();
    const rowsById = new Map(resources.map((resource) => [resource.id, resource]));
    const priceScopeByResource = await this.resolvePublicPriceScopes(siteId, resources);
    const priceScopeIds = [...new Set([...priceScopeByResource.values()].flat())];
    const [userOverrides, binding, user, resourceOverrides, defaultTemplate] = await Promise.all([
      userId
        ? prisma.user_resource_price_overrides.findMany({
          where: { siteId, userId, resourceId: { in: priceScopeIds }, durationDays },
        })
        : Promise.resolve([]),
      userId ? prisma.user_price_bindings.findUnique({ where: { siteId_userId: { siteId, userId } } }) : Promise.resolve(null),
      userId
        ? prisma.users.findFirst({
          where: { id: userId, siteId },
          select: { tenantId: true, tenant: { select: { ownerUserId: true } } },
        })
        : Promise.resolve(null),
      prisma.price_overrides.findMany({ where: { siteId, resourceId: { in: priceScopeIds }, durationDays } }),
      prisma.price_templates.findFirst({ where: { siteId, tenantId: null, isDefault: true }, select: { id: true } }),
    ]);
    const tenantDefaultTemplate = user
      ? await prisma.price_templates.findFirst({ where: { siteId, tenantId: user.tenantId, isDefault: true }, select: { id: true } })
      : null;
    const [userTemplateRules, tenantDefaultRules, defaultRules] = await Promise.all([
      binding
        ? prisma.price_rules.findMany({
          where: { siteId, templateId: binding.templateId, resourceId: { in: priceScopeIds }, durationDays, minQty: { lte: 1 } },
          orderBy: { minQty: 'desc' },
        })
        : Promise.resolve([]),
      tenantDefaultTemplate
        ? prisma.price_rules.findMany({
          where: { siteId, templateId: tenantDefaultTemplate.id, resourceId: { in: priceScopeIds }, durationDays, minQty: { lte: 1 } },
          orderBy: { minQty: 'desc' },
        })
        : Promise.resolve([]),
      defaultTemplate
        ? prisma.price_rules.findMany({
          where: { siteId, templateId: defaultTemplate.id, resourceId: { in: priceScopeIds }, durationDays, minQty: { lte: 1 } },
          orderBy: { minQty: 'desc' },
        })
        : Promise.resolve([]),
    ]);
    const userOverrideByResource = new Map(userOverrides.map((item) => [item.resourceId, item]));
    const userRuleByResource = firstRuleByResource(userTemplateRules);
    const tenantDefaultRuleByResource = firstRuleByResource(tenantDefaultRules);
    const overrideByResource = new Map(resourceOverrides.map((item) => [item.resourceId, item]));
    const defaultRuleByResource = firstRuleByResource(defaultRules);
    const prices = new Map<string, ResourcePrice>();

    for (const resourceId of resourceIds) {
      const resource = rowsById.get(resourceId);
      const priceScopeIdsForResource = priceScopeByResource.get(resourceId) ?? [resourceId];
      const candidates: PriceRow[] = [
          firstPriceInScope(userOverrideByResource, priceScopeIdsForResource),
          firstPriceInScope(userRuleByResource, priceScopeIdsForResource),
          firstPriceInScope(tenantDefaultRuleByResource, priceScopeIdsForResource),
          firstPriceInScope(overrideByResource, priceScopeIdsForResource),
          firstPriceInScope(defaultRuleByResource, priceScopeIdsForResource),
      ];
      const price = selectPublicPrice(candidates, currency);
      if (price === 'CURRENCY_MISMATCH') {
        continue;
      }
      if (price) {
        prices.set(resourceId, price);
        continue;
      }
      const basePrice = resource
        ? getBaseStaticProxyPrice({
          code: resource.code,
          providerCode: resource.providerCode,
          durationDays,
          currency,
        })
        : null;
      if (basePrice) prices.set(resourceId, basePrice);
    }
    return prices;
  }

  private async resolvePublicPriceScopes(
    siteId: string,
    resources: PriceableResource[],
  ): Promise<Map<string, string[]>> {
    return resolvePricingScopesForResources(siteId, resources);
  }

  private async getAdminOverridePriceMap(
    siteId: string,
    resourceIds: string[],
    durationDays: number,
    currency?: string,
  ): Promise<Map<string, ResourcePrice>> {
    if (resourceIds.length === 0) return new Map();
    const rows = await prisma.price_overrides.findMany({
      select: {
        resourceId: true,
        unitPrice: true,
        currency: true,
      },
      where: {
        siteId,
        resourceId: { in: resourceIds },
        durationDays,
        ...(currency ? { currency } : {}),
      },
    });
    return new Map(rows.map((row) => [
      row.resourceId,
      { unitPrice: row.unitPrice.toString(), currency: row.currency },
    ]));
  }
}

type ResourcePrice = {
  unitPrice: string;
  currency: string;
};

type PriceableResource = {
  id: string;
  code: string;
  providerCode: string;
  ipType: string;
};

type PriceRow =
  | Prisma.user_resource_price_overridesGetPayload<Record<string, never>>
  | Prisma.price_rulesGetPayload<Record<string, never>>
  | Prisma.price_overridesGetPayload<Record<string, never>>
  | null;

function toResourceListItem(row: ResourceWithInventory, price: ResourcePrice | null, includeUpstreamCost: boolean): ResourceListItem {
  const latest = row.inventory_snapshots[0];
  const mapping = row.resource_mappings[0] ?? null;
  const {
    inventory_snapshots: _snapshots,
    resource_mappings: _mappings,
    upstreamCost,
    upstreamCostCurrency,
    ...resource
  } = row;
  return {
    ...resource,
    countryCode: resourceCountryCode(resource.code),
    upstreamResourceId: mapping?.providerResourceId ?? null,
    stock: latest?.stock ?? null,
    inventoryCapturedAt: latest?.capturedAt ?? null,
    inventoryIsStale: latest ? isInventorySnapshotStale({ ...latest, providerCode: row.providerCode }) : null,
    unitPrice: price?.unitPrice ?? null,
    priceCurrency: price?.currency ?? null,
    costGroupKey: toPublicCostGroupKey(upstreamCost, upstreamCostCurrency),
    ...(includeUpstreamCost
      ? {
          upstreamCost: upstreamCost?.toString() ?? null,
          upstreamCostCurrency: upstreamCostCurrency ?? null,
        }
      : {}),
  };
}

function toPriceableCatalogItem(row: PriceableCatalogResource, price: ResourcePrice | null): ResourceListItem {
  const mapping = row.resource_mappings[0] ?? null;
  const {
    resource_mappings: _mappings,
    upstreamCost,
    upstreamCostCurrency,
    ...resource
  } = row;
  return {
    ...resource,
    countryCode: resourceCountryCode(resource.code),
    upstreamResourceId: mapping?.providerResourceId ?? null,
    stock: null,
    inventoryCapturedAt: null,
    inventoryIsStale: null,
    unitPrice: price?.unitPrice ?? null,
    priceCurrency: price?.currency ?? null,
    costGroupKey: toPublicCostGroupKey(upstreamCost, upstreamCostCurrency),
    upstreamCost: upstreamCost?.toString() ?? null,
    upstreamCostCurrency: upstreamCostCurrency ?? null,
  };
}

function toPublicCostGroupKey(
  upstreamCost: Prisma.Decimal | null | undefined,
  upstreamCostCurrency: string | null | undefined,
): string {
  if (!upstreamCost) return 'cost-missing';
  const currency = upstreamCostCurrency?.trim().toUpperCase() || 'CNY';
  const amount = normalizeCostAmount(upstreamCost.toString());
  const digest = createHash('sha256').update(`${currency}:${amount}`).digest('hex').slice(0, 16);
  return `cost-${digest}`;
}

function buildInternalPriceableCatalogGroups(rows: PriceableCatalogResource[]): InternalPriceableCatalogGroup[] {
  const groupedByCountry = new Map<string, InternalPriceableCatalogGroup[]>();
  const rowsByCountry = new Map<string, PriceableCatalogResource[]>();

  for (const row of rows) {
    const countryCode = resourceCountryCode(row.code);
    const regionKey = getPriceableCatalogRegionKey(row);
    const costGroupKey = toPublicCostGroupKey(row.upstreamCost, row.upstreamCostCurrency);
    const groupKey = makePriceableCatalogGroupKey(countryCode, regionKey, costGroupKey, false);
    const groups = groupedByCountry.get(countryCode) ?? [];
    let group = groups.find((item) => item.key === groupKey);
    if (!group) {
      group = {
        key: groupKey,
        countryCode,
        regionKey,
        costGroupKey,
        resourceIds: [],
        sampleResource: row,
        autoSelect: false,
      };
      groups.push(group);
      groupedByCountry.set(countryCode, groups);
    }
    group.resourceIds.push(row.id);

    const countryRows = rowsByCountry.get(countryCode) ?? [];
    countryRows.push(row);
    rowsByCountry.set(countryCode, countryRows);
  }

  const normalized: InternalPriceableCatalogGroup[] = [];
  for (const [countryCode, groups] of groupedByCountry.entries()) {
    const countryRows = rowsByCountry.get(countryCode) ?? [];
    if (shouldCollapseCountryRowsToAutoSelect(countryRows, groups)) {
      const first = countryRows[0]!;
      const costGroupKey = toPublicCostGroupKey(first.upstreamCost, first.upstreamCostCurrency);
      normalized.push({
        key: makePriceableCatalogGroupKey(countryCode, '__auto_select__', costGroupKey, true),
        countryCode,
        regionKey: '__auto_select__',
        costGroupKey,
        resourceIds: countryRows.map((row) => row.id),
        sampleResource: first,
        autoSelect: true,
      });
      continue;
    }
    normalized.push(...groups);
  }
  return normalized;
}

function shouldCollapseCountryRowsToAutoSelect(
  rows: PriceableCatalogResource[],
  groups: InternalPriceableCatalogGroup[],
): boolean {
  if (rows.length <= 1 || groups.length <= 1) return false;
  const costKeys = rows.map((row) => toPublicCostGroupKey(row.upstreamCost, row.upstreamCostCurrency));
  if (costKeys.some((key) => key === 'cost-missing')) return false;
  return new Set(costKeys).size === 1;
}

function shouldCollapseCountrySummaryToAutoSelect(item: {
  totalResources: number;
  regionKeys: Set<string>;
  costGroupKeys: Set<string>;
}): boolean {
  if (item.totalResources <= 1 || item.regionKeys.size <= 1) return false;
  if (item.costGroupKeys.has('cost-missing')) return false;
  return item.costGroupKeys.size === 1;
}

function makePriceableCatalogGroupKey(
  countryCode: string,
  regionKey: string,
  costGroupKey: string,
  autoSelect: boolean,
): string {
  const digest = createHash('sha256')
    .update(`${countryCode}:${regionKey}:${costGroupKey}:${autoSelect ? 'auto' : 'manual'}`)
    .digest('hex')
    .slice(0, 16);
  return `${countryCode}:${digest}`;
}

function getPriceableCatalogRegionKey(row: {
  code: string;
  name: string;
  displayName: string | null;
  resource_mappings: Array<{ providerResourceId: string }>;
}): string {
  const countryCode = resourceCountryCode(row.code);
  const mappingValue = stripIpipdCidr(row.resource_mappings[0]?.providerResourceId ?? null);
  const providerPath =
    parseProviderPathSegments(mappingValue, countryCode)
    ?? parseProviderPathSegments(row.code, countryCode)
    ?? parseProviderPathSegments(row.displayName, countryCode)
    ?? parseProviderPathSegments(row.name, countryCode);
  if (providerPath && providerPath.length > 0) {
    return normalizeGroupKey(providerPath.join('/'));
  }
  const codeDetail = parseCountryCodeDetail(row.code, countryCode);
  if (codeDetail) return normalizeGroupKey(codeDetail);
  return countryCode;
}

function stripIpipdCidr(value: string | null): string | null {
  if (!value) return null;
  const marker = '|cidr=';
  const markerIndex = value.indexOf(marker);
  return markerIndex >= 0 ? value.slice(0, markerIndex) : value;
}

function parseProviderPathSegments(value: string | null | undefined, countryCode: string): string[] | null {
  const raw = value?.trim();
  if (!raw || !raw.includes(':')) return null;
  const parts = raw.split(':').map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return null;
  if (parts[0]?.toUpperCase() !== countryCode) return null;
  const pathParts = parts.slice(1);
  if (pathParts.length > 1 && /^\d+$/.test(pathParts[0] ?? '')) pathParts.shift();
  return pathParts.length > 0 ? pathParts : null;
}

function parseCountryCodeDetail(value: string | null | undefined, countryCode: string): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const normalizedCountry = countryCode.toUpperCase();
  if (raw.toUpperCase() === normalizedCountry) return null;
  if (raw.toUpperCase().startsWith(`${normalizedCountry}:`)) {
    return raw.slice(normalizedCountry.length + 1).trim() || null;
  }
  return null;
}

function normalizeGroupKey(value: string): string {
  return value.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}

function toPriceableCatalogGroupItem(
  group: InternalPriceableCatalogGroup,
  priceByResource: Map<string, ResourcePrice>,
): PriceableCatalogGroupItem {
  const samplePrice = priceByResource.get(group.sampleResource.id) ?? null;
  const commonPrice = getCommonGroupPrice(group.resourceIds, priceByResource);
  return {
    key: group.key,
    countryCode: group.countryCode,
    regionKey: group.regionKey,
    costGroupKey: group.costGroupKey,
    resourceCount: group.resourceIds.length,
    pricedCount: group.resourceIds.filter((resourceId) => priceByResource.has(resourceId)).length,
    unitPrice: commonPrice?.unitPrice ?? null,
    priceCurrency: commonPrice?.currency ?? samplePrice?.currency ?? null,
    upstreamCost: group.sampleResource.upstreamCost?.toString() ?? null,
    upstreamCostCurrency: group.sampleResource.upstreamCostCurrency ?? null,
    autoSelect: group.autoSelect,
    sampleResource: toPriceableCatalogItem(group.sampleResource, samplePrice),
  };
}

function getCommonGroupPrice(
  resourceIds: string[],
  priceByResource: Map<string, ResourcePrice>,
): ResourcePrice | null {
  if (resourceIds.length === 0) return null;
  const prices = resourceIds.map((resourceId) => priceByResource.get(resourceId));
  if (prices.some((price) => !price)) return null;
  const first = prices[0]!;
  return prices.every((price) => price?.unitPrice === first.unitPrice && price.currency === first.currency)
    ? first
    : null;
}

function comparePriceableCatalogGroups(left: PriceableCatalogGroupItem, right: PriceableCatalogGroupItem): number {
  if (left.autoSelect !== right.autoSelect) return left.autoSelect ? -1 : 1;
  const regionCompare = left.regionKey.localeCompare(right.regionKey);
  if (regionCompare !== 0) return regionCompare;
  return comparePriceableCatalogCost(left, right);
}

function comparePriceableCatalogCost(left: PriceableCatalogGroupItem, right: PriceableCatalogGroupItem): number {
  const leftSort = getPriceableCatalogCostSort(left);
  const rightSort = getPriceableCatalogCostSort(right);
  if (leftSort.hasCost !== rightSort.hasCost) return leftSort.hasCost ? -1 : 1;
  const currencyCompare = leftSort.currency.localeCompare(rightSort.currency);
  if (currencyCompare !== 0) return currencyCompare;
  const amountCompare = leftSort.amount - rightSort.amount;
  if (amountCompare !== 0) return amountCompare;
  return left.key.localeCompare(right.key);
}

function getPriceableCatalogCostSort(item: Pick<PriceableCatalogGroupItem, 'upstreamCost' | 'upstreamCostCurrency'>): {
  hasCost: boolean;
  currency: string;
  amount: number;
} {
  const amount = item.upstreamCost === null ? Number.NaN : Number(item.upstreamCost);
  if (!Number.isFinite(amount)) return { hasCost: false, currency: '', amount: Number.POSITIVE_INFINITY };
  return {
    hasCost: true,
    currency: item.upstreamCostCurrency?.trim().toUpperCase() || 'CNY',
    amount,
  };
}

function normalizeCostAmount(value: string): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? String(amount) : value.trim();
}

function firstRuleByResource(
  rows: Prisma.price_rulesGetPayload<Record<string, never>>[],
): Map<string, Prisma.price_rulesGetPayload<Record<string, never>>> {
  const map = new Map<string, Prisma.price_rulesGetPayload<Record<string, never>>>();
  for (const row of rows) {
    if (!map.has(row.resourceId)) map.set(row.resourceId, row);
  }
  return map;
}

function firstPriceInScope<T extends { resourceId: string }>(
  rows: Map<string, T>,
  resourceIds: string[],
): T | null {
  for (const resourceId of resourceIds) {
    const row = rows.get(resourceId);
    if (row) return row;
  }
  return null;
}

function selectPublicPrice(rows: PriceRow[], currency: string): ResourcePrice | 'CURRENCY_MISMATCH' | null {
  for (const row of rows) {
    if (!row) continue;
    if (row.currency !== currency) return 'CURRENCY_MISMATCH';
    return { unitPrice: row.unitPrice.toString(), currency: row.currency };
  }
  return null;
}

function buildResourceSearchConditions(search: string | undefined): Prisma.platform_resourcesWhereInput[] {
  const trimmed = search?.trim();
  if (!trimmed) return [];

  const conditions: Prisma.platform_resourcesWhereInput[] = [];
  const seen = new Set<string>();

  const normalized = normalizeSearchAlias(trimmed);
  const countryMatches = RESOURCE_COUNTRY_SEARCH_ALIASES.filter((country) => country.aliases.some(
    (alias) => normalizeSearchAlias(alias) === normalized,
  ));
  const cityMatches = RESOURCE_CITY_SEARCH_ALIASES.filter((city) => city.aliases.some(
    (alias) => normalizeSearchAlias(alias) === normalized,
  ));
  const isTwoLetterCountryAlias = normalized.length === 2 && countryMatches.length > 0;

  if (!isTwoLetterCountryAlias) {
    addContainsConditions(conditions, seen, trimmed);
  }

  for (const country of countryMatches) {
    addCondition(conditions, seen, { code: { startsWith: country.code, mode: 'insensitive' } });
    addContainsConditions(conditions, seen, country.englishName);
  }

  for (const city of cityMatches) {
    for (const term of city.nameContains) addContainsConditions(conditions, seen, term);
    for (const code of city.codeStartsWith ?? []) {
      addCondition(conditions, seen, { code: { startsWith: code, mode: 'insensitive' } });
    }
    for (const code of city.codeContains ?? []) {
      addCondition(conditions, seen, { code: { contains: code, mode: 'insensitive' } });
    }
  }

  return conditions;
}

function addContainsConditions(
  conditions: Prisma.platform_resourcesWhereInput[],
  seen: Set<string>,
  text: string,
) {
  addCondition(conditions, seen, { code: { contains: text, mode: 'insensitive' } });
  addCondition(conditions, seen, { name: { contains: text, mode: 'insensitive' } });
  addCondition(conditions, seen, { displayName: { contains: text, mode: 'insensitive' } });
  addCondition(conditions, seen, { providerCode: { contains: text, mode: 'insensitive' } });
}

function addCondition(
  conditions: Prisma.platform_resourcesWhereInput[],
  seen: Set<string>,
  condition: Prisma.platform_resourcesWhereInput,
) {
  const key = JSON.stringify(condition);
  if (seen.has(key)) return;
  seen.add(key);
  conditions.push(condition);
}

function applyCountryCodeFilter(where: Prisma.platform_resourcesWhereInput, countryCode: string | undefined) {
  const normalized = countryCode?.trim().toUpperCase();
  if (!normalized || !/^[A-Z]{2}$/.test(normalized)) return;
  const countryCondition: Prisma.platform_resourcesWhereInput = {
    OR: [
      { code: { equals: normalized, mode: 'insensitive' } },
      { code: { startsWith: `${normalized}:`, mode: 'insensitive' } },
    ],
  };
  appendWhereAnd(where, countryCondition);
}

function normalizeCountryCodeOrThrow(countryCode: string | undefined): string {
  const normalized = countryCode?.trim().toUpperCase();
  if (!normalized || !/^[A-Z]{2}$/.test(normalized)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'country_code_invalid', 400);
  }
  return normalized;
}

function applyConcreteSaleableResourceFilter(where: Prisma.platform_resourcesWhereInput, siteId: string): void {
  appendWhereAnd(where, {
    OR: [
      { type: { not: 'COUNTRY' } },
      { resource_mappings: { some: { siteId } } },
    ],
  });
}

function appendWhereAnd(where: Prisma.platform_resourcesWhereInput, condition: Prisma.platform_resourcesWhereInput): void {
  where.AND = Array.isArray(where.AND) ? [...where.AND, condition] : [condition];
}

function normalizeSearchAlias(value: string): string {
  return value.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}

function normalizeUpstreamCost(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (text === '') return null;
  return /^\d+(\.\d+)?$/.test(text) ? text : null;
}

function buildResourceCoverageKeepFilter(resources: ResourceCoverageKey[]): Prisma.platform_resourcesWhereInput | null {
  const codesByIpType = new Map<ResourceCoverageKey['ipType'], Set<string>>();
  for (const resource of resources) {
    const code = resource.code.trim();
    if (!code) continue;
    const current = codesByIpType.get(resource.ipType) ?? new Set<string>();
    current.add(code);
    codesByIpType.set(resource.ipType, current);
  }
  const keepConditions: Prisma.platform_resourcesWhereInput[] = [...codesByIpType.entries()].map(([ipType, codes]) => ({
    ipType,
    code: { in: [...codes] },
  }));
  return keepConditions.length > 0 ? { OR: keepConditions } : null;
}

function parsePositiveInteger(value: string | number | undefined, fallback: number, field: string, max?: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, `${field}_invalid`, 400);
  }
  return max === undefined ? parsed : Math.min(parsed, max);
}

function isTruthy(value: string | boolean | undefined): boolean {
  return value === true || value === 'true' || value === '1';
}

function isResourceStatus(value: string): value is ResourceStatus {
  return ['ACTIVE', 'HIDDEN', 'DISABLED'].includes(value);
}

function isResourceType(value: string): value is ResourceType {
  return ['COUNTRY', 'REGION', 'ZONE'].includes(value);
}

const RESOURCE_COUNTRY_SEARCH_ALIASES: Array<{
  code: string;
  englishName: string;
  aliases: string[];
}> = [
  {
    code: 'AE',
    englishName: 'United Arab Emirates',
    aliases: ['阿联酋', '阿聯酋', 'united arab emirates', 'uae', 'ae'],
  },
  { code: 'AT', englishName: 'Austria', aliases: ['奥地利', '奧地利', 'austria', 'at'] },
  { code: 'AU', englishName: 'Australia', aliases: ['澳大利亚', '澳大利亞', 'australia', 'au'] },
  { code: 'BR', englishName: 'Brazil', aliases: ['巴西', 'brazil', 'br'] },
  { code: 'CA', englishName: 'Canada', aliases: ['加拿大', 'canada', 'ca'] },
  { code: 'DE', englishName: 'Germany', aliases: ['德国', '德國', 'germany', 'de'] },
  { code: 'ES', englishName: 'Spain', aliases: ['西班牙', 'spain', 'es'] },
  { code: 'FR', englishName: 'France', aliases: ['法国', '法國', 'france', 'fr'] },
  { code: 'GB', englishName: 'United Kingdom', aliases: ['英国', '英國', 'united kingdom', 'uk', 'gb'] },
  { code: 'HK', englishName: 'Hong Kong', aliases: ['中国香港', '中國香港', '香港', 'hong kong', 'hk'] },
  { code: 'ID', englishName: 'Indonesia', aliases: ['印度尼西亚', '印度尼西亞', 'indonesia', 'id'] },
  { code: 'IL', englishName: 'Israel', aliases: ['以色列', 'israel', 'il'] },
  { code: 'IN', englishName: 'India', aliases: ['印度', 'india', 'in'] },
  { code: 'IT', englishName: 'Italy', aliases: ['意大利', 'italy', 'it'] },
  { code: 'JP', englishName: 'Japan', aliases: ['日本', 'japan', 'jp'] },
  { code: 'KR', englishName: 'South Korea', aliases: ['韩国', '韓國', 'south korea', 'korea', 'kr'] },
  { code: 'LV', englishName: 'Latvia', aliases: ['拉脱维亚', '拉脫維亞', 'latvia', 'lv'] },
  { code: 'MY', englishName: 'Malaysia', aliases: ['马来西亚', '馬來西亞', 'malaysia', 'my'] },
  { code: 'NL', englishName: 'Netherlands', aliases: ['荷兰', '荷蘭', 'netherlands', 'nl'] },
  { code: 'PH', englishName: 'Philippines', aliases: ['菲律宾', '菲律賓', 'philippines', 'ph'] },
  { code: 'PL', englishName: 'Poland', aliases: ['波兰', '波蘭', 'poland', 'pl'] },
  { code: 'RO', englishName: 'Romania', aliases: ['罗马尼亚', '羅馬尼亞', 'romania', 'ro'] },
  { code: 'SG', englishName: 'Singapore', aliases: ['新加坡', 'singapore', 'sg'] },
  { code: 'TH', englishName: 'Thailand', aliases: ['泰国', '泰國', 'thailand', 'th'] },
  { code: 'TR', englishName: 'Turkey', aliases: ['土耳其', 'turkey', 'tr'] },
  { code: 'TW', englishName: 'Taiwan', aliases: ['中国台湾', '中國台灣', '台湾', '台灣', 'taiwan', 'tw'] },
  { code: 'UA', englishName: 'Ukraine', aliases: ['乌克兰', '烏克蘭', 'ukraine', 'ua'] },
  {
    code: 'US',
    englishName: 'United States',
    aliases: ['美国', '美國', 'united states', 'usa', 'america', 'us'],
  },
  { code: 'VN', englishName: 'Vietnam', aliases: ['越南', 'vietnam', 'vn'] },
  { code: 'ZA', englishName: 'South Africa', aliases: ['南非', 'south africa', 'za'] },
];

const RESOURCE_CITY_SEARCH_ALIASES: Array<{
  aliases: string[];
  nameContains: string[];
  codeStartsWith?: string[];
  codeContains?: string[];
}> = [
  {
    aliases: ['纽约', '紐約', 'new york', 'nyc'],
    nameContains: ['New York'],
    codeStartsWith: ['NY'],
    codeContains: [':NY', 'USANY', 'NYC', 'NYS'],
  },
  {
    aliases: ['洛杉矶', '洛杉磯', 'los angeles', 'lax'],
    nameContains: ['Los Angeles'],
    codeStartsWith: ['LAX'],
    codeContains: ['LAX', 'USACAL'],
  },
  {
    aliases: ['阿什本', 'ashburn'],
    nameContains: ['Ashburn'],
    codeStartsWith: ['ASH'],
    codeContains: ['ASH', 'VIRASH'],
  },
  {
    aliases: ['波士顿', '波士頓', 'boston'],
    nameContains: ['Boston'],
    codeStartsWith: ['BOS'],
    codeContains: ['BOS', 'MASBOS'],
  },
  {
    aliases: ['芝加哥', 'chicago'],
    nameContains: ['Chicago'],
    codeStartsWith: ['CHI'],
    codeContains: ['CHI'],
  },
  {
    aliases: ['达拉斯', '達拉斯', 'dallas'],
    nameContains: ['Dallas'],
    codeStartsWith: ['DAL'],
    codeContains: ['DAL'],
  },
  {
    aliases: ['迈阿密', '邁阿密', 'miami'],
    nameContains: ['Miami'],
    codeStartsWith: ['MIA'],
    codeContains: ['MIA'],
  },
  {
    aliases: ['旧金山', '舊金山', 'san francisco', 'sfo'],
    nameContains: ['San Francisco'],
    codeStartsWith: ['SFO'],
    codeContains: ['SFO'],
  },
  {
    aliases: ['西雅图', '西雅圖', 'seattle'],
    nameContains: ['Seattle'],
    codeStartsWith: ['SEA'],
    codeContains: ['SEA'],
  },
  {
    aliases: ['东京', '東京', 'tokyo'],
    nameContains: ['Tokyo'],
  },
  {
    aliases: ['香港', 'hong kong'],
    nameContains: ['Hong Kong'],
    codeStartsWith: ['HK'],
  },
  {
    aliases: ['新加坡', 'singapore'],
    nameContains: ['Singapore'],
    codeStartsWith: ['SG'],
    codeContains: ['SINGAPORE'],
  },
];
