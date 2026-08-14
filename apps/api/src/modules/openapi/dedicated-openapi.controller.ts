import { Controller, Get, Query } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import {
  AuthenticatedContext,
  requireScope,
  requireUserContext,
} from '../../common/auth/auth-context';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { RequireAuth } from '../../common/auth/guards';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { CatalogRepository } from '../catalog/catalog.repository';
import { SkuQuoteUseCase } from '../catalog/domain';
import { WalletRepository } from '../wallet/wallet.repository';

const DEDICATED_SCOPES = {
  catalogRead: 'dedicated:catalog:read',
  inventoryRead: 'dedicated:inventory:read',
  quoteRead: 'dedicated:quote:read',
  walletRead: 'dedicated:wallet:read',
} as const;

type InventoryQuery = {
  skuCode?: string;
  countryCode?: string;
};

type QuoteQuery = {
  skuCode: string;
  durationDays: string;
  quantity?: string;
  currency: string;
};

@Controller('openapi/dedicated')
@RequireAuth()
export class DedicatedOpenApiController {
  constructor(
    private readonly catalog: CatalogRepository,
    private readonly quoteUseCase: SkuQuoteUseCase,
    private readonly wallets: WalletRepository,
  ) {}

  @Get('skus')
  async listSkus(@CurrentContext() ctx: AuthenticatedContext) {
    const tenantId = requireDedicatedUser(ctx, DEDICATED_SCOPES.catalogRead);
    const skus = await this.catalog.listSaleableSkusForBuyer(ctx.siteId, tenantId, ctx.ownerId);
    return skus.map((sku) => ({
      id: sku.id,
      code: sku.code,
      name: sku.name,
      description: sku.description,
      capabilities: sku.capabilities,
      contractVersion: sku.contractVersion,
    }));
  }

  @Get('wallet')
  async wallet(@CurrentContext() ctx: AuthenticatedContext) {
    const tenantId = requireDedicatedUser(ctx, DEDICATED_SCOPES.walletRead);
    const wallet = await this.wallets.getWalletByUserId(ctx.ownerId, ctx.siteId, tenantId);
    return {
      available: wallet.available.toString(),
      frozen: wallet.frozen.toString(),
      currency: wallet.currency,
      updatedAt: wallet.updatedAt,
    };
  }

  @Get('inventory')
  async inventory(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: InventoryQuery,
  ) {
    const tenantId = requireDedicatedUser(ctx, DEDICATED_SCOPES.inventoryRead);
    const saleable = await this.catalog.listSaleableSkusForBuyer(ctx.siteId, tenantId, ctx.ownerId);
    const requestedSkuCode = query.skuCode?.trim().toUpperCase();
    const requestedCountryCode = query.countryCode?.trim().toUpperCase();
    const skuIds = saleable
      .filter((sku) => !requestedSkuCode || sku.code === requestedSkuCode)
      .map((sku) => sku.id);
    if (requestedSkuCode && skuIds.length === 0) {
      throw new AppError(ErrorCode.NOT_FOUND, 'sku_not_found', 404);
    }

    const rows = await prisma.dedicated_line_inventory_snapshots.findMany({
      where: {
        siteId: ctx.siteId,
        skuId: { in: skuIds },
        ...(requestedCountryCode ? { countryCode: requestedCountryCode } : {}),
      },
      include: { sku: { select: { code: true, name: true, contractVersion: true } } },
      orderBy: { capturedAt: 'desc' },
      distinct: ['providerAccountId', 'skuId', 'countryCode', 'providerResourceId'],
    });
    const now = new Date();
    return rows.map((row) => ({
      sku: row.sku,
      countryCode: row.countryCode,
      quantity: row.quantity,
      reservedQuantity: row.reservedQuantity,
      availableQuantity: Math.max(0, row.quantity - row.reservedQuantity),
      capturedAt: row.capturedAt,
      expiresAt: row.expiresAt,
      isStale: row.expiresAt <= now,
    }));
  }

  @Get('quote')
  quote(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: QuoteQuery,
  ) {
    const tenantId = requireDedicatedUser(ctx, DEDICATED_SCOPES.quoteRead);
    return this.quoteUseCase.execute({
      siteId: ctx.siteId,
      tenantId,
      userId: ctx.ownerId,
      skuCode: query.skuCode,
      durationDays: Number(query.durationDays),
      quantity: query.quantity ? Number(query.quantity) : 1,
      currency: query.currency,
    });
  }
}

function requireDedicatedUser(ctx: AuthenticatedContext, scope: string): string {
  requireUserContext(ctx);
  requireScope(ctx, scope);
  if (!ctx.tenantId) {
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'tenant_required', 403);
  }
  return ctx.tenantId;
}
