import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Prisma, IpType, Protocol, ResourceStatus, ResourceType } from '@ipeasy/db/generated/client';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { RequireAuth } from '../../common/auth/guards';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PageResult } from '../../common/pagination/pagination.dto';
import { ProviderCode } from '../providers/provider.types';
import {
  PublicResourceCountryItem,
  ResourceListItem,
  ResourceListQuery,
  ResourcesRepository,
} from './resources.repository';
import { SyncInventoryUseCase } from './use-cases/sync-inventory.use-case';

type CreateResourceBody = {
  parentId?: string | null;
  type: ResourceType;
  code: string;
  name: string;
  displayName?: string | null;
  providerCode: ProviderCode;
  ipType: IpType;
  protocol: Protocol;
  status?: ResourceStatus;
  sortOrder?: number;
  isVisible?: boolean;
  isSaleable?: boolean;
  unsaleableReason?: string | null;
};

type UpdateResourceBody = Partial<{
  parentId: string | null;
  type: ResourceType;
  code: string;
  name: string;
  displayName: string | null;
  providerCode: ProviderCode;
  ipType: IpType;
  protocol: Protocol;
  status: ResourceStatus;
  sortOrder: number;
  isVisible: boolean;
  isSaleable: boolean;
  unsaleableReason: string | null;
}>;

type SyncInventoryBody = {
  providerCode?: ProviderCode;
  accountId?: string | null;
};

type PriceableCatalogGroupSaleabilityBody = {
  countryCode?: string;
  regionKey?: string;
  costGroupKey?: string;
  autoSelect?: boolean;
  providerCode?: ProviderCode;
  saleable?: boolean;
};

type UpdateInventoryBody = {
  stock?: number | string;
  freshnessTtlSeconds?: number | string;
};

@Controller('resources')
export class ResourcesController {
  constructor(
    private readonly repo: ResourcesRepository,
    private readonly syncInventory: SyncInventoryUseCase,
  ) {}

  @Get()
  @RequireAuth()
  list(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: ResourceListQuery,
  ): Promise<PageResult<ResourceListItem>> {
    if (ctx.ownerType === 'USER') {
      return this.repo.list(ctx.siteId, {
        ...query,
        publicOnly: true,
        userId: ctx.ownerId,
        tenantId: ctx.tenantId ?? null,
      });
    }
    if (ctx.ownerType === 'PLATFORM_ADMIN' || ctx.ownerType === 'TENANT_ADMIN') {
      return this.repo.list(ctx.siteId, { ...query, tenantId: ctx.tenantId ?? null });
    }
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
  }

  @Get('priceable-catalog/summary')
  @RequireAuth()
  priceableCatalogSummary(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: ResourceListQuery,
  ) {
    assertAdmin(ctx);
    return this.repo.listPriceableCatalogSummary(ctx.siteId, { ...query, tenantId: ctx.tenantId ?? null });
  }

  @Get('priceable-catalog/groups')
  @RequireAuth()
  priceableCatalogGroups(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: ResourceListQuery,
  ) {
    assertAdmin(ctx);
    return this.repo.listPriceableCatalogGroups(ctx.siteId, { ...query, tenantId: ctx.tenantId ?? null });
  }

  @Post('priceable-catalog/group-saleability')
  @RequireAuth()
  updatePriceableCatalogGroupSaleability(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: PriceableCatalogGroupSaleabilityBody,
  ) {
    assertAdmin(ctx);
    assertPriceableCatalogGroupSaleabilityBody(body);
    return this.repo.updatePriceableCatalogGroupSaleability(ctx.siteId, {
      countryCode: body.countryCode,
      regionKey: body.regionKey,
      costGroupKey: body.costGroupKey,
      autoSelect: body.autoSelect,
      providerCode: body.providerCode,
      tenantId: ctx.tenantId ?? null,
    }, body.saleable === true);
  }

  @Get('priceable-catalog')
  @RequireAuth()
  priceableCatalog(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: ResourceListQuery,
  ): Promise<PageResult<ResourceListItem>> {
    assertAdmin(ctx);
    return this.repo.listPriceableCatalog(ctx.siteId, { ...query, tenantId: ctx.tenantId ?? null });
  }

  @Get('countries')
  @RequireAuth()
  countries(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: ResourceListQuery,
  ): Promise<{ items: PublicResourceCountryItem[] }> {
    if (ctx.ownerType === 'USER') {
      return this.repo.listPublicCountries(ctx.siteId, {
        ...query,
        publicOnly: true,
        userId: ctx.ownerId,
        tenantId: ctx.tenantId ?? null,
      });
    }
    if (ctx.ownerType === 'PLATFORM_ADMIN' || ctx.ownerType === 'TENANT_ADMIN') {
      return this.repo.listPublicCountries(ctx.siteId, { ...query, tenantId: ctx.tenantId ?? null });
    }
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
  }

  @Post()
  @RequireAuth()
  create(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: CreateResourceBody,
  ) {
    assertAdmin(ctx);
    assertCreateResourceBody(body);
    const data: Prisma.platform_resourcesUncheckedCreateInput = {
      siteId: ctx.siteId,
      parentId: body.parentId ?? undefined,
      type: body.type,
      code: body.code,
      name: body.name,
      displayName: body.displayName ?? undefined,
      providerCode: body.providerCode,
      ipType: body.ipType,
      protocol: body.protocol,
      status: body.status ?? 'ACTIVE',
      sortOrder: body.sortOrder === undefined ? 0 : Number(body.sortOrder),
      isVisible: body.isVisible ?? true,
      isSaleable: body.isSaleable ?? true,
      unsaleableReason: body.unsaleableReason ?? undefined,
    };
    return this.repo.create(data);
  }

  @Put(':id')
  @RequireAuth()
  async update(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
    @Body() body: UpdateResourceBody,
  ) {
    assertAdmin(ctx);
    const existing = await this.repo.findByIdInSite(id, ctx.siteId);
    if (!existing) throw new AppError(ErrorCode.NOT_FOUND, 'resource_not_found', 404);
    assertUpdateResourceBody(body);
    return this.repo.update(id, ctx.siteId, toResourceUpdateData(body));
  }

  @Get(':id/inventory')
  @RequireAuth()
  async getInventory(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
  ) {
    const existing = await this.repo.findByIdInSite(id, ctx.siteId);
    if (!existing) throw new AppError(ErrorCode.NOT_FOUND, 'resource_not_found', 404);
    const latest = await this.repo.getLatestInventory(id, ctx.siteId, existing.upstreamAccountId);
    if (!latest) throw new AppError(ErrorCode.UPSTREAM_ERROR, 'inventory_stale', 422);
    return latest;
  }

  @Put(':id/inventory')
  @RequireAuth()
  async updateInventory(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
    @Body() body: UpdateInventoryBody,
  ) {
    assertAdmin(ctx);
    const resource = await this.repo.findByIdInSite(id, ctx.siteId);
    if (!resource) throw new AppError(ErrorCode.NOT_FOUND, 'resource_not_found', 404);
    const stock = parseInventoryStock(body.stock);
    const freshnessTtlSeconds = parseFreshnessTtlSeconds(body.freshnessTtlSeconds);
    await this.repo.upsertInventorySnapshot({
      siteId: ctx.siteId,
      resourceId: resource.id,
      providerCode: resource.providerCode,
      upstreamAccountId: resource.upstreamAccountId,
      stock,
      capturedAt: new Date(),
      freshnessTtlSeconds,
    });
    const latest = await this.repo.getLatestInventory(resource.id, ctx.siteId, resource.upstreamAccountId);
    if (!latest) throw new AppError(ErrorCode.UPSTREAM_ERROR, 'inventory_stale', 422);
    return latest;
  }

  @Post('sync-inventory')
  @RequireAuth()
  async syncInventoryHandler(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: SyncInventoryBody,
  ) {
    assertAdmin(ctx);
    if (!body.providerCode) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'provider_code_required', 400);
    }
    if (ctx.ownerType === 'TENANT_ADMIN' && body.accountId) {
      await this.assertTenantCanUseProviderAccount(ctx, body.providerCode, body.accountId);
    }
    return this.syncInventory.execute(ctx.siteId, body.providerCode, ctx.tenantId ?? null, body.accountId ?? null);
  }

  @Post(':id/sync-inventory')
  @RequireAuth()
  async syncResourceInventory(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
  ) {
    assertAdmin(ctx);
    const resource = await this.repo.findByIdInSite(id, ctx.siteId);
    if (!resource) throw new AppError(ErrorCode.NOT_FOUND, 'resource_not_found', 404);
    return this.syncInventory.execute(ctx.siteId, resource.providerCode as ProviderCode, ctx.tenantId ?? null, resource.upstreamAccountId);
  }

  private async assertTenantCanUseProviderAccount(
    ctx: AuthenticatedContext,
    providerCode: ProviderCode,
    accountId: string,
  ): Promise<void> {
    const tenantId = await this.repo.findProviderAccountTenant(ctx.siteId, providerCode, accountId);
    if (tenantId === undefined) {
      throw new AppError(ErrorCode.NOT_FOUND, 'provider_account_not_found', 404);
    }
    if (tenantId !== null && tenantId !== ctx.tenantId) {
      throw new AppError(ErrorCode.TENANT_SCOPE_VIOLATION, 'tenant_access_denied', 403);
    }
  }
}

function assertAdmin(ctx: AuthenticatedContext): void {
  if (ctx.ownerType !== 'PLATFORM_ADMIN' && ctx.ownerType !== 'TENANT_ADMIN') {
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
  }
}

function assertCreateResourceBody(body: CreateResourceBody): void {
  if (!body.code || !body.name || !body.type || !body.providerCode || !body.ipType || !body.protocol) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'resource_required_fields_missing', 400);
  }
  if (!isResourceType(body.type) || !isProviderCode(body.providerCode) || !isIpType(body.ipType) || !isProtocol(body.protocol)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'resource_enum_invalid', 400);
  }
  if (body.status !== undefined && !isResourceStatus(body.status)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'resource_status_invalid', 400);
  }
  if (body.sortOrder !== undefined && !Number.isInteger(Number(body.sortOrder))) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'sort_order_invalid', 400);
  }
}

function assertUpdateResourceBody(body: UpdateResourceBody): void {
  if (body.type !== undefined && !isResourceType(body.type)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'resource_type_invalid', 400);
  }
  if (body.providerCode !== undefined && !isProviderCode(body.providerCode)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'provider_code_invalid', 400);
  }
  if (body.ipType !== undefined && !isIpType(body.ipType)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'ip_type_invalid', 400);
  }
  if (body.protocol !== undefined && !isProtocol(body.protocol)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'protocol_invalid', 400);
  }
  if (body.status !== undefined && !isResourceStatus(body.status)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'resource_status_invalid', 400);
  }
  if (body.sortOrder !== undefined && !Number.isInteger(Number(body.sortOrder))) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'sort_order_invalid', 400);
  }
}

function assertPriceableCatalogGroupSaleabilityBody(body: PriceableCatalogGroupSaleabilityBody): void {
  if (!body.countryCode?.trim()) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'country_code_required', 400);
  }
  if (!/^[A-Za-z]{2}$/.test(body.countryCode.trim())) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'country_code_invalid', 400);
  }
  if (body.providerCode !== undefined && !isProviderCode(body.providerCode)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'provider_code_invalid', 400);
  }
  if (typeof body.saleable !== 'boolean') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'resource_saleability_invalid', 400);
  }
  if (!body.autoSelect && (!body.regionKey?.trim() || !body.costGroupKey?.trim())) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'resource_group_required', 400);
  }
}

function parseInventoryStock(value: UpdateInventoryBody['stock']): number {
  const stock = Number(value);
  if (!Number.isInteger(stock) || stock < 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'inventory_stock_invalid', 400);
  }
  return stock;
}

function parseFreshnessTtlSeconds(value: UpdateInventoryBody['freshnessTtlSeconds']): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const ttl = Number(value);
  if (!Number.isInteger(ttl) || ttl < 60) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'inventory_ttl_invalid', 400);
  }
  return ttl;
}

function toResourceUpdateData(body: UpdateResourceBody): Prisma.platform_resourcesUncheckedUpdateInput {
  const data: Prisma.platform_resourcesUncheckedUpdateInput = {};
  if ('parentId' in body) data.parentId = body.parentId;
  if (body.type) data.type = body.type;
  if (body.code) data.code = body.code;
  if (body.name) data.name = body.name;
  if ('displayName' in body) data.displayName = body.displayName;
  if (body.providerCode) data.providerCode = body.providerCode;
  if (body.ipType) data.ipType = body.ipType;
  if (body.protocol) data.protocol = body.protocol;
  if (body.status) data.status = body.status;
  if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder);
  if (body.isVisible !== undefined) data.isVisible = body.isVisible;
  if (body.isSaleable !== undefined) data.isSaleable = body.isSaleable;
  if ('unsaleableReason' in body) data.unsaleableReason = body.unsaleableReason;
  return data;
}

function isResourceType(value: string): value is ResourceType {
  return ['COUNTRY', 'REGION', 'ZONE'].includes(value);
}

function isIpType(value: string): value is IpType {
  return ['NATIVE', 'BROADCAST', 'BOTH'].includes(value);
}

function isProtocol(value: string): value is Protocol {
  return ['HTTP', 'SOCKS5', 'BOTH'].includes(value);
}

function isResourceStatus(value: string): value is ResourceStatus {
  return ['ACTIVE', 'HIDDEN', 'DISABLED'].includes(value);
}

function isProviderCode(value: string): value is ProviderCode {
  return ['IPIPD', 'NINE_EIGHT_FIVE', 'PR', 'UPSTREAM_API'].includes(value);
}
