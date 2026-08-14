import { Controller, Get, Post, Delete, Param, Body, Put, Query } from '@nestjs/common';
import { RequireAuth } from '../../common/auth/guards';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PageQueryDto } from '../../common/pagination/pagination.dto';
import { assertSafeUrl } from '../../common/utils/ssrf';
import { UpstreamAccountListItem, UpstreamAccountsRepository } from './upstream-accounts.repository';
import { UpstreamApiAdapter } from '../providers/adapters/upstream-api.adapter';
import { ConfigService } from '../../common/config/config.service';
import { encryptAesGcm } from '../../common/crypto/aes-gcm';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { SyncInventoryUseCase } from '../resources/use-cases/sync-inventory.use-case';
import { ProviderHealthResult } from '../providers/provider.types';
import { ResourcesRepository } from '../resources/resources.repository';

@Controller('upstream-accounts')
export class UpstreamAccountsController {
  constructor(
    private readonly repo: UpstreamAccountsRepository,
    private readonly adapter: UpstreamApiAdapter,
    private readonly registry: ProviderRegistryService,
    private readonly config: ConfigService,
    private readonly syncInventoryUseCase: SyncInventoryUseCase,
    private readonly resourcesRepo: ResourcesRepository,
  ) {}

  @Get()
  @RequireAuth()
  async list(@CurrentContext() ctx: AuthenticatedContext, @Query() query: PageQueryDto) {
    if (ctx.ownerType === 'PLATFORM_ADMIN') {
      return this.repo.listForSite(ctx.siteId, query);
    }
    if (ctx.ownerType === 'TENANT_ADMIN') {
      return this.repo.listForTenant(ctx.siteId, ctx.tenantId!, query);
    }
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
  }

  @Post()
  @RequireAuth()
  async create(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: { name: string; baseUrl: string; apiKey: string; timeoutMs?: number; inventorySyncEnabled?: boolean },
  ) {
    let tenantId: string | null = null;
    if (ctx.ownerType === 'TENANT_ADMIN') {
      tenantId = ctx.tenantId!;
    } else if (ctx.ownerType !== 'PLATFORM_ADMIN') {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
    }

    assertRequestBody(body);
    const encKey = this.config.get('APP_ENCRYPTION_KEY');
    const apiKeyEncrypted = encryptAesGcm(assertApiKey(body.apiKey), encKey);

    const account = await this.repo.create({
      siteId: ctx.siteId,
      tenantId,
      name: assertName(body.name),
      baseUrl: assertBaseUrl(body.baseUrl),
      apiKeyEncrypted,
      timeoutMs: body.timeoutMs === undefined ? undefined : assertTimeoutMs(body.timeoutMs),
      inventorySyncEnabled: body.inventorySyncEnabled === undefined ? undefined : assertBoolean(body.inventorySyncEnabled, 'inventory_sync_enabled_invalid'),
    });
    return toListItem(account);
  }

  @Put(':id')
  @RequireAuth()
  async update(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
    @Body() body: {
      name?: unknown;
      baseUrl?: unknown;
      apiKey?: unknown;
      timeoutMs?: unknown;
      inventorySyncEnabled?: unknown;
    },
  ): Promise<UpstreamAccountListItem> {
    assertRequestBody(body);
    if (ctx.ownerType !== 'PLATFORM_ADMIN' && ctx.ownerType !== 'TENANT_ADMIN') {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
    }
    const account = await this.repo.findById(id);
    if (!account || account.siteId !== ctx.siteId) {
      throw new AppError(ErrorCode.NOT_FOUND, 'account_not_found', 404);
    }
    if (ctx.ownerType === 'TENANT_ADMIN' && account.tenantId !== ctx.tenantId) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
    }

    const data: Partial<{
      name: string;
      baseUrl: string;
      apiKeyEncrypted: string;
      timeoutMs: number;
      inventorySyncEnabled: boolean;
    }> = {};
    if (body.name !== undefined) data.name = assertName(body.name);
    if (body.baseUrl !== undefined) data.baseUrl = assertBaseUrl(body.baseUrl);
    if (body.apiKey !== undefined) {
      data.apiKeyEncrypted = encryptAesGcm(assertApiKey(body.apiKey), this.config.get('APP_ENCRYPTION_KEY'));
    }
    if (body.timeoutMs !== undefined) data.timeoutMs = assertTimeoutMs(body.timeoutMs);
    if (body.inventorySyncEnabled !== undefined) {
      data.inventorySyncEnabled = assertBoolean(body.inventorySyncEnabled, 'inventory_sync_enabled_invalid');
    }
    if (Object.keys(data).length === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'upstream_account_update_empty', 400);
    }

    const updated = await this.repo.update(id, data);
    const resourceInvalidationReason = upstreamResourceConfigChangeReason(data);
    if (resourceInvalidationReason) {
      await this.resourcesRepo.hideUpstreamAccountResources(ctx.siteId, 'UPSTREAM_API', updated.id, resourceInvalidationReason);
    }
    return toListItem(updated);
  }

  @Post(':id/test')
  @RequireAuth()
  async test(@CurrentContext() ctx: AuthenticatedContext, @Param('id') id: string): Promise<ProviderHealthResult> {
    const account = await this.repo.findById(id);
    if (!account || account.siteId !== ctx.siteId) {
      throw new AppError(ErrorCode.NOT_FOUND, 'account_not_found', 404);
    }
    if (ctx.ownerType === 'TENANT_ADMIN' && account.tenantId !== null && account.tenantId !== ctx.tenantId) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
    }

    const start = Date.now();
    try {
      const runtimeConfig = await this.registry.getConfigForUpstreamAccountById(account.siteId, account.id);
      return await this.adapter.healthCheck(runtimeConfig);
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: upstreamProbeReasonKey(error),
      };
    }
  }

  @Post(':id/sync-inventory')
  @RequireAuth()
  async syncInventory(@CurrentContext() ctx: AuthenticatedContext, @Param('id') id: string) {
    if (ctx.ownerType !== 'PLATFORM_ADMIN' && ctx.ownerType !== 'TENANT_ADMIN') {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
    }
    const account = await this.repo.findById(id);
    if (!account || account.siteId !== ctx.siteId) {
      throw new AppError(ErrorCode.NOT_FOUND, 'account_not_found', 404);
    }
    if (ctx.ownerType === 'TENANT_ADMIN' && account.tenantId !== null && account.tenantId !== ctx.tenantId) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
    }
    if (!account.inventorySyncEnabled) {
      throw new AppError(ErrorCode.UPSTREAM_DISABLED, 'inventory_sync_disabled', 503);
    }

    return this.syncInventoryUseCase.execute(ctx.siteId, 'UPSTREAM_API', ctx.tenantId ?? null, id);
  }

  @Delete(':id')
  @RequireAuth()
  async disable(@CurrentContext() ctx: AuthenticatedContext, @Param('id') id: string) {
    const account = await this.repo.findById(id);
    if (!account || account.siteId !== ctx.siteId) {
      throw new AppError(ErrorCode.NOT_FOUND, 'account_not_found', 404);
    }
    if (ctx.ownerType === 'TENANT_ADMIN' && account.tenantId !== ctx.tenantId) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
    }
    if (ctx.ownerType !== 'PLATFORM_ADMIN' && ctx.ownerType !== 'TENANT_ADMIN') {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
    }
    const disabled = await this.repo.disable(id);
    await this.resourcesRepo.hideUpstreamAccountResources(ctx.siteId, 'UPSTREAM_API', disabled.id, 'provider_disabled');
    return toListItem(disabled);
  }
}

function toListItem(account: {
  id: string;
  siteId: string;
  tenantId: string | null;
  name: string;
  baseUrl: string;
  status: string;
  timeoutMs: number;
  inventorySyncEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}): UpstreamAccountListItem {
  return {
    id: account.id,
    siteId: account.siteId,
    tenantId: account.tenantId,
    name: account.name,
    baseUrl: account.baseUrl,
    status: account.status,
    timeoutMs: account.timeoutMs,
    inventorySyncEnabled: account.inventorySyncEnabled,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function assertRequestBody(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'invalid_request', 400);
  }
}

function assertName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'upstream_name_required', 400);
  }
  return value.trim();
}

function assertApiKey(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'upstream_api_key_required', 400);
  }
  return value.trim();
}

function assertBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'base_url_required', 400);
  }
  const normalized = normalizeUpstreamApiBaseUrl(value.trim());
  assertSafeUrl(normalized);
  return normalized;
}

function normalizeUpstreamApiBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'base_url_invalid', 400);
  }
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/g, '').replace(/\/res_static$/i, '');
  return url.toString().replace(/\/$/g, '');
}

function assertTimeoutMs(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1000 || numeric > 120000) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'provider_timeout_invalid', 400);
  }
  return numeric;
}

function assertBoolean(value: unknown, reasonKey: string): boolean {
  if (typeof value !== 'boolean') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400);
  }
  return value;
}

function upstreamProbeReasonKey(error: unknown): string {
  if (error instanceof AppError) return error.reasonKey;
  return 'upstream_error';
}

function upstreamResourceConfigChangeReason(data: Partial<{
  name: string;
  baseUrl: string;
  apiKeyEncrypted: string;
  timeoutMs: number;
  inventorySyncEnabled: boolean;
}>): string | null {
  if (data.inventorySyncEnabled === false) return 'inventory_sync_disabled';
  if (data.baseUrl !== undefined || data.apiKeyEncrypted !== undefined) return 'provider_config_changed';
  return null;
}
