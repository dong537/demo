import { Controller, Get, Query } from '@nestjs/common';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { RequireAuth, RequireUser } from '../../common/auth/guards';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { CatalogRepository } from './catalog.repository';
import { ServiceSku, SkuQuoteInput, SkuQuoteUseCase } from './domain';

type CustomerQuoteQuery = {
  skuCode: string;
  durationDays: string;
  quantity?: string;
  currency: string;
};

type AdminQuoteQuery = CustomerQuoteQuery & {
  tenantId: string;
  userId: string;
};

@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly repository: CatalogRepository,
    private readonly quoteUseCase: SkuQuoteUseCase,
  ) {}

  @Get('skus')
  @RequireUser()
  async listCustomerSkus(@CurrentContext() ctx: AuthenticatedContext) {
    if (!ctx.tenantId) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'tenant_required', 403);
    }
    const skus = await this.repository.listSaleableSkusForBuyer(ctx.siteId, ctx.tenantId, ctx.ownerId);
    return skus.map(toCatalogSkuDto);
  }

  @Get('admin/skus')
  @RequireAuth()
  async listAdminSkus(@CurrentContext() ctx: AuthenticatedContext) {
    assertCatalogAdmin(ctx);
    const skus = await this.repository.listSkus(ctx.siteId, true);
    return skus.map(toCatalogSkuDto);
  }

  @Get('quote')
  @RequireUser()
  quoteCustomer(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: CustomerQuoteQuery,
  ) {
    if (!ctx.tenantId) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'tenant_required', 403);
    }
    return this.quoteUseCase.execute(toQuoteInput(ctx.siteId, ctx.tenantId, ctx.ownerId, query));
  }

  @Get('admin/quote')
  @RequireAuth()
  quoteAdmin(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: AdminQuoteQuery,
  ) {
    assertCatalogAdmin(ctx);
    if (ctx.ownerType === 'TENANT_ADMIN' && ctx.tenantId !== query.tenantId) {
      throw new AppError(ErrorCode.TENANT_SCOPE_VIOLATION, 'tenant_access_denied', 403);
    }
    return this.quoteUseCase.execute(toQuoteInput(ctx.siteId, query.tenantId, query.userId, query));
  }
}

function assertCatalogAdmin(ctx: AuthenticatedContext): void {
  if (ctx.ownerType !== 'PLATFORM_ADMIN' && ctx.ownerType !== 'TENANT_ADMIN') {
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
  }
}

function toQuoteInput(
  siteId: string,
  tenantId: string,
  userId: string,
  query: CustomerQuoteQuery,
): SkuQuoteInput {
  return {
    siteId,
    tenantId,
    userId,
    skuCode: query.skuCode,
    durationDays: Number(query.durationDays),
    quantity: query.quantity ? Number(query.quantity) : 1,
    currency: query.currency,
  };
}

function toCatalogSkuDto(sku: ServiceSku) {
  return {
    id: sku.id,
    code: sku.code,
    name: sku.name,
    description: sku.description,
    capabilities: sku.capabilities,
    contractVersion: sku.contractVersion,
    isActive: sku.isActive,
    isVisible: sku.isVisible,
  };
}
