import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import type { ProxyStatus } from '@ipeasy/db';
import { RequireUser } from '../../common/auth/guards';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { ResourcesRepository } from '../resources/resources.repository';
import { QuoteUseCase } from '../pricing/use-cases/quote.use-case';
import { OrdersRepository } from '../orders/orders.repository';
import { ProxiesRepository } from '../proxies/proxies.repository';
import { WalletRepository } from '../wallet/wallet.repository';
import { RenewProxyUseCase } from '../proxies/use-cases/renew-proxy.use-case';
import { ChangePasswordUseCase } from '../proxies/use-cases/change-password.use-case';
import { SwitchIpUseCase } from '../proxies/use-cases/switch-ip.use-case';
import { decodePublicId, mapProxy, mapOrder, mapResource } from './res-static.mapper';
import { decryptAesGcm } from '../../common/crypto/aes-gcm';
import { ConfigService } from '../../common/config/config.service';
import {
  BusinessListDto,
  InventoryQueryDto,
  CalculateDto,
  BuyDto,
  RenewDto,
  OrderResultDto,
  OrderListDto,
  IpListDto,
  IpExportDto,
  IpDetailDto,
  ChangeAuthDto,
  SwitchIpListDto,
  SwitchIpDto,
  WalletRecordsDto,
} from './res-static.dto';
import { ErrorCode } from '../../common/errors/error-codes';
import { formatProxyExport, parseProxyExportFormat } from '../proxies/proxy-export';
import { ProxyAuditService } from '../proxies/proxy-audit.service';
import { assertStaticProxyPurchaseDisabled } from '../orders/static-purchase-disabled';

const OPENAPI_PROXY_EXPORT_LIMIT = 1000;
const OPENAPI_RESOURCE_PAGE_SIZE = 20;

@Controller('res_static')
export class ResStaticController {
  constructor(
    private readonly resourcesRepo: ResourcesRepository,
    private readonly quoteUseCase: QuoteUseCase,
    private readonly ordersRepo: OrdersRepository,
    private readonly proxiesRepo: ProxiesRepository,
    private readonly walletRepo: WalletRepository,
    private readonly renewProxy: RenewProxyUseCase,
    private readonly changePassword: ChangePasswordUseCase,
    private readonly switchIp: SwitchIpUseCase,
    private readonly config: ConfigService,
    private readonly proxyAudit: ProxyAuditService,
  ) {}

  @Post('business')
  @HttpCode(200)
  @RequireUser()
  async business(@CurrentContext() ctx: AuthenticatedContext, @Body() _body: BusinessListDto) {
    requireTenantId(ctx);
    const resources = await this.resourcesRepo.list(ctx.siteId, { pageSize: OPENAPI_RESOURCE_PAGE_SIZE, publicOnly: true });
    return resources.items.map((resource) => mapResource(resource));
  }

  @Post('inventory')
  @HttpCode(200)
  @RequireUser()
  async inventory(@CurrentContext() ctx: AuthenticatedContext, @Body() body: InventoryQueryDto) {
    requireTenantId(ctx);
    if (!body.resource_id) {
      const resources = await this.resourcesRepo.list(ctx.siteId, { pageSize: OPENAPI_RESOURCE_PAGE_SIZE, publicOnly: true });
      return resources.items.map((resource) => mapResourceWithInventory(resource, resource.stock, resource.inventoryIsStale));
    }

    const resourceId = decodePublicId('resource', body.resource_id);
    const resource = await this.resourcesRepo.findByIdInSite(resourceId, ctx.siteId);
    if (!resource) throw new AppError(ErrorCode.NOT_FOUND, 'resource_not_found', 404);

    const inventory = await this.resourcesRepo.getLatestInventory(resourceId, ctx.siteId, resource.upstreamAccountId);
    return [mapResourceWithInventory(resource, inventory?.stock ?? null, inventory?.isStale ?? null)];
  }

  @Post('calculate')
  @HttpCode(200)
  @RequireUser()
  async calculate(@CurrentContext() ctx: AuthenticatedContext, @Body() body: CalculateDto) {
    assertCalculateBody(body);
    const result = await this.quoteUseCase.execute({
      siteId: ctx.siteId,
      tenantId: requireTenantId(ctx),
      userId: ctx.ownerId,
      resourceId: decodePublicId('resource', body.resource_id),
      durationDays: positiveInteger(body.duration_days, 'duration_days'),
      quantity: positiveInteger(body.quantity, 'quantity'),
      currency: body.currency,
    });
    return {
      resource_id: body.resource_id,
      unit_price: result.unitPrice,
      total_price: result.totalPrice,
      currency: result.currency,
      duration_days: result.durationDays,
      quantity: result.quantity,
    };
  }

  @Post('buy')
  @HttpCode(200)
  @RequireUser()
  async buy(@CurrentContext() _ctx: AuthenticatedContext, @Body() _body: BuyDto) {
    assertStaticProxyPurchaseDisabled();
  }

  @Post('renew')
  @HttpCode(200)
  @RequireUser()
  async renew(@CurrentContext() ctx: AuthenticatedContext, @Body() body: RenewDto) {
    assertRenewBody(body);
    const proxy = await this.renewProxy.execute(
      ctx,
      decodePublicId('proxy', body.proxy_id),
      positiveInteger(body.duration_days, 'duration_days'),
      body.idempotency_key,
    );
    return mapProxy(proxy, this.decryptProxyPassword(proxy.password));
  }

  @Post('order_result')
  @HttpCode(200)
  @RequireUser()
  async orderResult(@CurrentContext() ctx: AuthenticatedContext, @Body() body: OrderResultDto) {
    const tenantId = requireTenantId(ctx);
    const order = await this.ordersRepo.findById(decodePublicId('order', requireOrderNo(body)));
    if (!order || order.userId !== ctx.ownerId || order.tenantId !== tenantId || order.siteId !== ctx.siteId) {
      throw new AppError(ErrorCode.NOT_FOUND, 'order_not_found', 404);
    }
    const proxies = await this.proxiesRepo.findByOrderId(order.id, ctx.ownerId, tenantId);
    return {
      ...mapOrder(order),
      proxy_list: proxies.map((proxy) => mapProxy(proxy, this.decryptProxyPassword(proxy.password))),
    };
  }

  @Post('order_list')
  @HttpCode(200)
  @RequireUser()
  async orderList(@CurrentContext() ctx: AuthenticatedContext, @Body() body: OrderListDto) {
    const result = await this.ordersRepo.list(ctx.ownerId, requireTenantId(ctx), {
      page: optionalPositiveInteger(body.page, 1, 'page'),
      pageSize: optionalPositiveInteger(body.page_size, 20, 'page_size'),
      status: body.status,
    });
    return mapPage(result, mapOrder);
  }

  @Post('ip_list')
  @HttpCode(200)
  @RequireUser()
  async ipList(@CurrentContext() ctx: AuthenticatedContext, @Body() body: IpListDto) {
    const result = await this.proxiesRepo.findByUserId(ctx.ownerId, ctx.siteId, requireTenantId(ctx), {
      page: optionalPositiveInteger(body.page, 1, 'page'),
      pageSize: optionalPositiveInteger(body.page_size, 20, 'page_size'),
      status: body.status as ProxyStatus | undefined,
      countryCode: body.country_code,
      search: body.search,
      from: body.from,
      to: body.to,
    });
    return mapPage(result, (proxy) => mapProxy(proxy, this.decryptProxyPassword(proxy.password)));
  }

  @Post('ip_export')
  @HttpCode(200)
  @RequireUser()
  async ipExport(@CurrentContext() ctx: AuthenticatedContext, @Body() body: IpExportDto = {}) {
    const format = parseProxyExportFormat(body.format);
    const result = await this.proxiesRepo.findByUserId(ctx.ownerId, ctx.siteId, requireTenantId(ctx), {
      page: 1,
      pageSize: OPENAPI_PROXY_EXPORT_LIMIT,
      status: (body.status as ProxyStatus | undefined) ?? 'ACTIVE',
      countryCode: body.country_code,
      search: body.search,
      from: body.from,
      to: body.to,
    });
    const lines = result.items.map((proxy) => formatProxyExport({
      ip: proxy.ip,
      port: proxy.port,
      username: proxy.username,
      password: this.decryptProxyPassword(proxy.password),
      format,
    }));
    await this.proxyAudit.recordExport(ctx, { format, count: lines.length });
    return { format, count: lines.length, lines };
  }

  @Post('ip_detail')
  @HttpCode(200)
  @RequireUser()
  async ipDetail(@CurrentContext() ctx: AuthenticatedContext, @Body() body: IpDetailDto) {
    const tenantId = requireTenantId(ctx);
    const proxy = await this.proxiesRepo.findById(decodePublicId('proxy', requiredString(body.proxy_id, 'proxy_id')));
    if (!proxy || proxy.userId !== ctx.ownerId || proxy.tenantId !== tenantId || proxy.siteId !== ctx.siteId) {
      throw new AppError(ErrorCode.NOT_FOUND, 'proxy_not_found', 404);
    }
    return mapProxy(proxy, this.decryptProxyPassword(proxy.password));
  }

  @Post('change_auth')
  @HttpCode(200)
  @RequireUser()
  async changeAuth(@CurrentContext() ctx: AuthenticatedContext, @Body() body: ChangeAuthDto) {
    const proxy = await this.changePassword.execute(ctx, decodePublicId('proxy', requiredString(body.proxy_id, 'proxy_id')));
    return mapProxy(proxy, this.decryptProxyPassword(proxy.password));
  }

  @Post('switch_ip_list')
  @HttpCode(200)
  @RequireUser()
  async switchIpList(@CurrentContext() ctx: AuthenticatedContext, @Body() body: SwitchIpListDto) {
    const result = await this.proxiesRepo.findByUserId(ctx.ownerId, ctx.siteId, requireTenantId(ctx), {
      page: optionalPositiveInteger(body.page, 1, 'page'),
      pageSize: optionalPositiveInteger(body.page_size, 20, 'page_size'),
      status: 'ACTIVE',
    });
    return mapPage(result, (proxy) => mapProxy(proxy, this.decryptProxyPassword(proxy.password)));
  }

  @Post('switch_ip')
  @HttpCode(200)
  @RequireUser()
  async switchIpAction(@CurrentContext() ctx: AuthenticatedContext, @Body() body: SwitchIpDto) {
    const proxy = await this.switchIp.execute(ctx, decodePublicId('proxy', requiredString(body.proxy_id, 'proxy_id')));
    return mapProxy(proxy, this.decryptProxyPassword(proxy.password));
  }

  @Post('wallet/balance')
  @HttpCode(200)
  @RequireUser()
  async walletBalance(@CurrentContext() ctx: AuthenticatedContext) {
    const wallet = await this.walletRepo.getWalletByUserId(ctx.ownerId, ctx.siteId, requireTenantId(ctx));
    return { balance: wallet.available.toString(), currency: wallet.currency };
  }

  @Post('wallet/records')
  @HttpCode(200)
  @RequireUser()
  async walletRecords(@CurrentContext() ctx: AuthenticatedContext, @Body() body: WalletRecordsDto) {
    const tenantId = requireTenantId(ctx);
    const wallet = await this.walletRepo.getWalletByUserId(ctx.ownerId, ctx.siteId, tenantId);
    const result = await this.walletRepo.listLedgerEntries(wallet.id, tenantId, {
      page: optionalPositiveInteger(body.page, 1, 'page'),
      pageSize: optionalPositiveInteger(body.page_size, 20, 'page_size'),
    });
    return mapPage(result, (entry) => ({
      type: entry.type,
      amount: entry.amount.toString(),
      balance_after: entry.balanceAfter.toString(),
      currency: entry.currency,
      reason: entry.reason,
      create_time: entry.createdAt.toISOString(),
    }));
  }

  private decryptProxyPassword(encrypted: string): string {
    return decryptAesGcm(encrypted, this.config.get('APP_ENCRYPTION_KEY'));
  }
}

function requireTenantId(ctx: AuthenticatedContext): string {
  if (!ctx.tenantId) {
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'tenant_required', 403);
  }
  return ctx.tenantId;
}

function mapResourceWithInventory(
  resource: Parameters<typeof mapResource>[0],
  stock: number | null,
  stale: boolean | null,
) {
  if (stock === null || stale) {
    throw new AppError(ErrorCode.UPSTREAM_ERROR, 'inventory_stale', 422);
  }
  return mapResource(resource, stock);
}

function assertCalculateBody(body: CalculateDto): void {
  requiredString(body.resource_id, 'resource_id');
  positiveInteger(body.duration_days, 'duration_days');
  positiveInteger(body.quantity, 'quantity');
  requiredString(body.currency, 'currency');
}

function assertRenewBody(body: RenewDto): void {
  requiredString(body.proxy_id, 'proxy_id');
  positiveInteger(body.duration_days, 'duration_days');
}

function requireOrderNo(body: OrderResultDto): string {
  return requiredString(body.order_no, 'order_no');
}

function requiredString(value: string | undefined, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, `${field}_required`, 400);
  }
  return value;
}

function positiveInteger(value: string | number | undefined, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, `${field}_invalid`, 400);
  }
  return parsed;
}

function optionalPositiveInteger(value: string | number | undefined, fallback: number, field: string): number {
  return value === undefined ? fallback : positiveInteger(value, field);
}

function mapPage<T, U>(
  page: { page: number; pageSize: number; total: number; items: T[] },
  mapper: (item: T) => U,
) {
  return {
    page: page.page,
    page_size: page.pageSize,
    total: page.total,
    items: page.items.map(mapper),
  };
}
