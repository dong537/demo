import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { prisma, Prisma } from '@ipeasy/db';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { RequireAuth } from '../../common/auth/guards';
import { assertTenantAccess } from '../../common/auth/tenant-guard';
import { decryptAesGcm, encryptAesGcm } from '../../common/crypto/aes-gcm';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { requestIdStorage } from '../../common/logging/request-id.context';
import { ConfigService } from '../../common/config/config.service';
import { normalizeProviderBaseUrl } from '../providers/provider-base-url';
import { normalizeProviderCredential, trimCredentialObject } from '../providers/provider-credential';
import { ProvidersRepository } from '../providers/providers.repository';
import { SyncInventoryUseCase } from '../resources/use-cases/sync-inventory.use-case';
import {
  CreateTenantProviderAccountDto,
  TenantProviderAccountDto,
  UpdateTenantProviderAccountDto,
} from './dto';
import {
  NativeProviderCode,
  TenantProviderAccountsRepository,
  TenantProviderAccountStatus,
} from './tenant-provider-accounts.repository';
import { TenantsRepository } from './tenants.repository';

@Controller('tenants/:tenantId/provider-accounts')
export class TenantProviderAccountsController {
  constructor(
    private readonly tenantsRepo: TenantsRepository,
    private readonly accountsRepo: TenantProviderAccountsRepository,
    private readonly config: ConfigService,
    private readonly providersRepo: ProvidersRepository,
    private readonly syncInventory: SyncInventoryUseCase,
  ) {}

  @Get()
  @RequireAuth()
  @ApiOkResponse({ type: [TenantProviderAccountDto] })
  async list(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('tenantId') tenantId: string,
  ) {
    await this.assertCanAccessTenant(ctx, tenantId);
    const accounts = await this.accountsRepo.list(ctx.siteId, tenantId);
    return accounts.map(toDto);
  }

  @Post()
  @RequireAuth()
  @ApiCreatedResponse({ type: TenantProviderAccountDto })
  async create(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('tenantId') tenantId: string,
    @Body() body: CreateTenantProviderAccountDto,
  ) {
    await this.assertCanAccessTenant(ctx, tenantId);
    assertRequestBody(body);
    const providerCode = assertNativeProviderCode(body.providerCode);
    const baseUrl = assertBaseUrl(providerCode, body.baseUrl);
    const credential = normalizeProviderCredential(providerCode, body.credential, { partial: false });
    const credentialEncrypted = this.encryptCredential(credential);

    const account = await this.accountsRepo.create({
      siteId: ctx.siteId,
      tenantId,
      providerCode,
      credentialEncrypted,
      baseUrl,
      timeoutMs: body.timeoutMs === undefined ? undefined : assertTimeoutMs(body.timeoutMs),
      inventorySyncEnabled: body.inventorySyncEnabled === undefined ? undefined : assertBoolean(body.inventorySyncEnabled, 'inventory_sync_enabled_invalid'),
      enabledCountryCodes: normalizeEnabledCountryCodes(providerCode, body.enabledCountryCodes),
    });

    await writeAudit(ctx, tenantId, account.id, 'tenant.provider_account.create', {
      providerCode,
      baseUrl,
      timeoutMs: account.timeoutMs,
      inventorySyncEnabled: account.inventorySyncEnabled,
      enabledCountryCodes: account.enabledCountryCodes,
    });

    return toDto(account);
  }

  @Put(':accountId')
  @RequireAuth()
  @ApiOkResponse({ type: TenantProviderAccountDto })
  async update(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('tenantId') tenantId: string,
    @Param('accountId') accountId: string,
    @Body() body: UpdateTenantProviderAccountDto,
  ) {
    await this.assertCanAccessTenant(ctx, tenantId);
    assertRequestBody(body);
    const existing = await this.accountsRepo.findById(ctx.siteId, tenantId, accountId);
    if (!existing) throw new AppError(ErrorCode.NOT_FOUND, 'provider_account_not_found', 404);
    const data: {
      status?: TenantProviderAccountStatus;
      credentialEncrypted?: string;
      baseUrl?: string;
      timeoutMs?: number;
      inventorySyncEnabled?: boolean;
      enabledCountryCodes?: string[];
    } = {};

    if (body.status !== undefined) data.status = assertProviderAccountStatus(body.status);
    if (body.credential !== undefined) {
      data.credentialEncrypted = this.encryptMergedCredential(existing.providerCode, existing.credentialEncrypted, body.credential);
    }
    if (body.baseUrl !== undefined) {
      data.baseUrl = assertBaseUrl(existing.providerCode, body.baseUrl);
    }
    if (body.timeoutMs !== undefined) data.timeoutMs = assertTimeoutMs(body.timeoutMs);
    if (body.inventorySyncEnabled !== undefined) {
      data.inventorySyncEnabled = assertBoolean(body.inventorySyncEnabled, 'inventory_sync_enabled_invalid');
    }
    if (body.enabledCountryCodes !== undefined) {
      data.enabledCountryCodes = normalizeEnabledCountryCodes(existing.providerCode, body.enabledCountryCodes);
    }
    if (Object.keys(data).length === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'provider_account_update_empty', 400);
    }

    const updated = await this.accountsRepo.update(ctx.siteId, tenantId, accountId, data);
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND, 'provider_account_not_found', 404);
    const resourceInvalidationReason = providerResourceConfigChangeReason(data);
    const resourceSelection = resourceInvalidationReason
      ? await this.providersRepo.hideProviderAccountResources(ctx.siteId, updated.providerCode, updated.id, resourceInvalidationReason)
      : data.enabledCountryCodes === undefined
        ? null
        : await this.providersRepo.applyEnabledCountrySelectionToResources(ctx.siteId, updated.providerCode, updated.enabledCountryCodes, updated.id);

    await writeAudit(ctx, tenantId, accountId, 'tenant.provider_account.update', {
      changedFields: Object.keys(data).filter((key) => key !== 'credentialEncrypted').concat(data.credentialEncrypted ? ['credential'] : []),
      status: updated.status,
      baseUrl: updated.baseUrl,
      timeoutMs: updated.timeoutMs,
      inventorySyncEnabled: updated.inventorySyncEnabled,
      enabledCountryCodes: updated.enabledCountryCodes,
      resourceSelection,
    });

    return toDto(updated);
  }

  @Post(':accountId/sync-inventory')
  @RequireAuth()
  async syncInventoryHandler(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('tenantId') tenantId: string,
    @Param('accountId') accountId: string,
  ) {
    await this.assertCanAccessTenant(ctx, tenantId);
    const account = await this.accountsRepo.findById(ctx.siteId, tenantId, accountId);
    if (!account) throw new AppError(ErrorCode.NOT_FOUND, 'provider_account_not_found', 404);
    return this.syncInventory.execute(ctx.siteId, account.providerCode, tenantId, account.id);
  }

  @Delete(':accountId')
  @RequireAuth()
  @ApiOkResponse({ type: TenantProviderAccountDto })
  async disable(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('tenantId') tenantId: string,
    @Param('accountId') accountId: string,
  ) {
    await this.assertCanAccessTenant(ctx, tenantId);
    const account = await this.accountsRepo.disable(ctx.siteId, tenantId, accountId);
    if (!account) throw new AppError(ErrorCode.NOT_FOUND, 'provider_account_not_found', 404);
    await this.providersRepo.hideProviderAccountResources(ctx.siteId, account.providerCode, account.id, 'provider_disabled');

    await writeAudit(ctx, tenantId, accountId, 'tenant.provider_account.disable', {
      providerCode: account.providerCode,
      status: account.status,
    });

    return toDto(account);
  }

  private async assertCanAccessTenant(ctx: AuthenticatedContext, tenantId: string): Promise<void> {
    if (ctx.ownerType !== 'PLATFORM_ADMIN' && ctx.ownerType !== 'TENANT_ADMIN') {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
    }
    const tenant = await this.tenantsRepo.findById(ctx.siteId, tenantId);
    if (!tenant) throw new AppError(ErrorCode.NOT_FOUND, 'tenant_not_found', 404);
    assertTenantAccess(ctx, tenantId);
  }

  private encryptCredential(credential: Record<string, string>): string {
    return encryptAesGcm(JSON.stringify(credential), this.config.get('APP_ENCRYPTION_KEY'));
  }

  private encryptMergedCredential(providerCode: NativeProviderCode, currentEncrypted: string, patch: unknown): string {
    const currentCredential = this.decryptCredential(currentEncrypted);
    const patchCredential = normalizeProviderCredential(providerCode, patch, { partial: true });
    const merged = normalizeProviderCredential(providerCode, { ...currentCredential, ...patchCredential }, { partial: false });
    return this.encryptCredential(merged);
  }

  private decryptCredential(encrypted: string): Record<string, string> {
    try {
      const parsed = JSON.parse(decryptAesGcm(encrypted, this.config.get('APP_ENCRYPTION_KEY'))) as unknown;
      return trimCredentialObject(parsed, { partial: false });
    } catch {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 'credential_decrypt_failed', 500);
    }
  }
}

function toDto(account: {
  id: string;
  siteId: string;
  tenantId: string | null;
  providerCode: NativeProviderCode;
  status: TenantProviderAccountStatus;
  baseUrl: string;
  timeoutMs: number;
  inventorySyncEnabled: boolean;
  enabledCountryCodes: string[];
  createdAt: Date;
  updatedAt: Date;
}): TenantProviderAccountDto {
  return {
    id: account.id,
    siteId: account.siteId,
    tenantId: account.tenantId ?? '',
    providerCode: account.providerCode,
    status: account.status,
    baseUrl: account.baseUrl,
    timeoutMs: account.timeoutMs,
    inventorySyncEnabled: account.inventorySyncEnabled,
    enabledCountryCodes: account.enabledCountryCodes,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    availableCountries: [],
  };
}

function normalizeEnabledCountryCodes(providerCode: NativeProviderCode, value: unknown): string[] {
  void providerCode;
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'enabled_country_codes_invalid', 400);
  }
  const unique = [...new Set(value.map((item) => {
    if (typeof item !== 'string') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'enabled_country_codes_invalid', 400);
    }
    return item.trim().toUpperCase();
  }).filter(Boolean))];
  for (const code of unique) {
    if (!/^[A-Z]{2}$/.test(code)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'enabled_country_code_not_supported', 400);
    }
  }
  return unique;
}

async function writeAudit(
  ctx: AuthenticatedContext,
  tenantId: string,
  targetId: string,
  action: string,
  meta: Record<string, unknown>,
): Promise<void> {
  await prisma.audit_logs.create({
    data: {
      siteId: ctx.siteId,
      tenantId,
      actorType: ctx.ownerType === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_USER',
      actorId: ctx.ownerId,
      targetType: 'provider_account',
      targetId,
      action,
      requestId: requestIdStorage.getStore() ?? ctx.requestId,
      meta: meta as Prisma.InputJsonObject,
    },
  });
}

function assertNativeProviderCode(value: unknown): NativeProviderCode {
  if (value === 'IPIPD' || value === 'NINE_EIGHT_FIVE' || value === 'PR') return value;
  throw new AppError(ErrorCode.VALIDATION_ERROR, 'provider_code_invalid', 400);
}

function assertProviderAccountStatus(value: unknown): TenantProviderAccountStatus {
  if (value === 'ACTIVE' || value === 'DISABLED') return value;
  throw new AppError(ErrorCode.VALIDATION_ERROR, 'provider_account_status_invalid', 400);
}

function assertTimeoutMs(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1000 || numeric > 120000) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'provider_timeout_invalid', 400);
  }
  return numeric;
}

function assertBaseUrl(providerCode: NativeProviderCode, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'base_url_required', 400);
  }
  return normalizeProviderBaseUrl(providerCode, value);
}

function assertBoolean(value: unknown, reasonKey: string): boolean {
  if (typeof value !== 'boolean') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400);
  }
  return value;
}

function assertRequestBody(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'invalid_request', 400);
  }
}

function providerResourceConfigChangeReason(data: Partial<{
  status: TenantProviderAccountStatus;
  credentialEncrypted: string;
  baseUrl: string;
  timeoutMs: number;
  inventorySyncEnabled: boolean;
  enabledCountryCodes: string[];
}>): string | null {
  if (data.status === 'DISABLED') return 'provider_disabled';
  if (data.inventorySyncEnabled === false) return 'inventory_sync_disabled';
  if (data.baseUrl !== undefined || data.credentialEncrypted !== undefined) return 'provider_config_changed';
  return null;
}
