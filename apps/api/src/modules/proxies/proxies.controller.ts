import { Controller, Get, Post, Param, Query, Body } from '@nestjs/common';
import { RequireAuth, RequireUser } from '../../common/auth/guards';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { PageResult } from '../../common/pagination/pagination.dto';
import { ProxiesRepository, ProxyInstance, ProxyListQuery } from './proxies.repository';
import { RenewProxyUseCase } from './use-cases/renew-proxy.use-case';
import { ChangePasswordUseCase } from './use-cases/change-password.use-case';
import { SwitchIpUseCase } from './use-cases/switch-ip.use-case';
import { BatchProxyLifecycleResult, BatchProxyLifecycleUseCase } from './use-cases/batch-proxy-lifecycle.use-case';
import { decryptAesGcm } from '../../common/crypto/aes-gcm';
import { ConfigService } from '../../common/config/config.service';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { formatProxyExport, parseProxyExportFormat } from './proxy-export';
import { ProxyAuditService } from './proxy-audit.service';

@Controller('proxies')
export class ProxiesController {
  constructor(
    private readonly proxiesRepo: ProxiesRepository,
    private readonly renewUseCase: RenewProxyUseCase,
    private readonly changePasswordUseCase: ChangePasswordUseCase,
    private readonly switchIpUseCase: SwitchIpUseCase,
    private readonly batchLifecycleUseCase: BatchProxyLifecycleUseCase,
    private readonly config: ConfigService,
    private readonly audit: ProxyAuditService,
  ) {}

  @Get('export')
  @RequireUser()
  async export(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query('format') rawFormat?: string,
  ): Promise<string[]> {
    const tenantId = requireTenantId(ctx);
    const format = parseProxyExportFormat(rawFormat);
    const proxies = await this.proxiesRepo.findAllActiveByUserId(ctx.ownerId, ctx.siteId, tenantId);
    const encKey = this.config.get('APP_ENCRYPTION_KEY');
    const lines = proxies.map((p) => {
      const pass = decryptAesGcm(p.password, encKey);
      return formatProxyExport({ ip: p.ip, port: p.port, username: p.username, password: pass, format });
    });
    await this.audit.recordExport(ctx, { format, count: lines.length });
    return lines;
  }

  @Get()
  @RequireAuth()
  async list(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: ProxyListQuery,
  ): Promise<PageResult<unknown>> {
    if (ctx.ownerType === 'USER') {
      const result = await this.proxiesRepo.findByUserId(ctx.ownerId, ctx.siteId, requireTenantId(ctx), query);
      const encKey = this.config.get('APP_ENCRYPTION_KEY');
      return { ...result, items: result.items.map((proxy) => toDeliveryDto(proxy, encKey)) };
    }
    if (ctx.ownerType === 'TENANT_ADMIN') {
      const result = await this.proxiesRepo.listForAdmin(ctx.siteId, requireTenantId(ctx), query);
      return { ...result, items: result.items.map(toAdminDto) };
    }
    if (ctx.ownerType === 'PLATFORM_ADMIN') {
      const result = await this.proxiesRepo.listForAdmin(ctx.siteId, query.tenantId ?? null, query);
      return { ...result, items: result.items.map(toAdminDto) };
    }
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
  }

  @Get(':id')
  @RequireUser()
  async getById(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
  ) {
    const proxy = await this.proxiesRepo.findById(id);
    if (!proxy || proxy.userId !== ctx.ownerId) {
      throw new AppError(ErrorCode.NOT_FOUND, 'proxy_not_found', 404);
    }
    if (proxy.tenantId !== requireTenantId(ctx)) {
      throw new AppError(ErrorCode.NOT_FOUND, 'proxy_not_found', 404);
    }
    return toDeliveryDto(proxy, this.config.get('APP_ENCRYPTION_KEY'));
  }

  @Post('batch-renew')
  @RequireUser()
  async batchRenew(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: { proxyIds: string[]; durationDays: number | string; idempotencyKey?: string },
  ) {
    const result = await this.batchLifecycleUseCase.renew(ctx, body);
    return toBatchDeliveryDto(result, this.config.get('APP_ENCRYPTION_KEY'));
  }

  @Post('batch-change-password')
  @RequireUser()
  async batchChangePassword(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: { proxyIds: string[] },
  ) {
    const result = await this.batchLifecycleUseCase.changePassword(ctx, body);
    return toBatchDeliveryDto(result, this.config.get('APP_ENCRYPTION_KEY'));
  }

  @Post('batch-switch-ip')
  @RequireUser()
  async batchSwitchIp(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: { proxyIds: string[] },
  ) {
    const result = await this.batchLifecycleUseCase.switchIp(ctx, body);
    return toBatchDeliveryDto(result, this.config.get('APP_ENCRYPTION_KEY'));
  }

  @Post(':id/renew')
  @RequireUser()
  async renew(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
    @Body() body: { durationDays: number; idempotencyKey?: string },
  ) {
    const proxy = await this.renewUseCase.execute(ctx, id, Number(body.durationDays), body.idempotencyKey);
    return toDeliveryDto(proxy, this.config.get('APP_ENCRYPTION_KEY'));
  }

  @Post(':id/change-password')
  @RequireUser()
  async changePassword(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
  ) {
    const proxy = await this.changePasswordUseCase.execute(ctx, id);
    return toDeliveryDto(proxy, this.config.get('APP_ENCRYPTION_KEY'));
  }

  @Post(':id/switch-ip')
  @RequireUser()
  async switchIp(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
  ) {
    const proxy = await this.switchIpUseCase.execute(ctx, id);
    return toDeliveryDto(proxy, this.config.get('APP_ENCRYPTION_KEY'));
  }
}

function requireTenantId(ctx: AuthenticatedContext): string {
  if (!ctx.tenantId) {
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'tenant_required', 403);
  }
  return ctx.tenantId;
}

function toDeliveryDto(proxy: ProxyInstance, encryptionKey: string) {
  return {
    id: proxy.id,
    siteId: proxy.siteId,
    tenantId: proxy.tenantId,
    userId: proxy.userId,
    orderId: proxy.orderId,
    providerCode: proxy.providerCode,
    ip: proxy.ip,
    port: proxy.port,
    username: proxy.username,
    password: decryptAesGcm(proxy.password, encryptionKey),
    protocol: proxy.protocol,
    countryCode: proxy.countryCode,
    regionCode: proxy.regionCode,
    ipType: proxy.ipType,
    status: proxy.status,
    expiresAt: proxy.expiresAt,
    businessType: proxy.businessType,
    userNote: proxy.userNote,
    createdAt: proxy.createdAt,
    updatedAt: proxy.updatedAt,
  };
}

function toBatchDeliveryDto(result: BatchProxyLifecycleResult, encryptionKey: string) {
  return {
    totalCount: result.totalCount,
    successCount: result.successCount,
    failureCount: result.failureCount,
    items: result.items.map((item) => item.success
      ? {
          proxyId: item.proxyId,
          success: true,
          proxy: toDeliveryDto(item.proxy, encryptionKey),
        }
      : item),
  };
}

function toAdminDto(proxy: ProxyInstance) {
  return {
    id: proxy.id,
    siteId: proxy.siteId,
    tenantId: proxy.tenantId,
    userId: proxy.userId,
    orderId: proxy.orderId,
    providerCode: proxy.providerCode,
    ip: proxy.ip,
    port: proxy.port,
    protocol: proxy.protocol,
    countryCode: proxy.countryCode,
    regionCode: proxy.regionCode,
    ipType: proxy.ipType,
    status: proxy.status,
    expiresAt: proxy.expiresAt,
    businessType: proxy.businessType,
    userNote: proxy.userNote,
    createdAt: proxy.createdAt,
    updatedAt: proxy.updatedAt,
  };
}
