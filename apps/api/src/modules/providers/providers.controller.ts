import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { prisma, Prisma } from '@ipeasy/db';
import { RequireAuth } from '../../common/auth/guards';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { ConfigService } from '../../common/config/config.service';
import { decryptAesGcm, encryptAesGcm } from '../../common/crypto/aes-gcm';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { requestIdStorage } from '../../common/logging/request-id.context';
import { ListProvidersUseCase } from './use-cases/list-providers.use-case';
import { HealthCheckProviderUseCase } from './use-cases/health-check-provider.use-case';
import { CreateProviderAccountDto, ProviderAccountListItemDto, ProviderHealthCheckResultDto, UpdateProviderAccountDto } from './dto';
import { deriveCapabilities, requireProviderAdmin } from './admin-access';
import { ProvidersRepository, ProviderAccountRecord, ProviderResourceSaleabilityChange } from './providers.repository';
import { ProviderRegistryService } from './provider-registry.service';
import { ProviderCode } from './provider.types';
import { normalizeProviderBaseUrl } from './provider-base-url';
import { normalizeProviderCredential, trimCredentialObject } from './provider-credential';

type ProviderResourceSaleabilityBody = {
  items?: Array<{
    resourceId?: unknown;
    saleable?: unknown;
  }>;
};

/**
 * Platform-facing provider-health surface. Distinct from
 * `upstream-accounts` (the UPSTREAM_API gateway accounts): this reads native
 * `provider_accounts` and runs on-demand connectivity probes. PLATFORM_ADMIN
 * only — enforced in the use-cases.
 */
@Controller('providers')
export class ProvidersController {
  constructor(
    private readonly listUseCase: ListProvidersUseCase,
    private readonly healthCheckUseCase: HealthCheckProviderUseCase,
    private readonly repo: ProvidersRepository,
    private readonly registry: ProviderRegistryService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @RequireAuth()
  async list(@CurrentContext() ctx: AuthenticatedContext): Promise<ProviderAccountListItemDto[]> {
    return this.listUseCase.execute(ctx);
  }

  @Post(':id/health-check')
  @RequireAuth()
  async healthCheck(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
  ): Promise<ProviderHealthCheckResultDto> {
    return this.healthCheckUseCase.execute(ctx, id);
  }

  @Post()
  @RequireAuth()
  async create(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: CreateProviderAccountDto,
  ): Promise<ProviderAccountListItemDto> {
    requireProviderAdmin(ctx);
    assertRequestBody(body);
    const providerCode = assertProviderCode(body.providerCode);
    const baseUrl = assertBaseUrl(providerCode, body.baseUrl);
    const credential = normalizeProviderCredential(providerCode, body.credential, { partial: false });
    const account = await this.repo.create({
      siteId: ctx.siteId,
      providerCode,
      status: body.status === undefined ? 'ACTIVE' : assertProviderAccountStatus(body.status),
      credentialEncrypted: this.encryptCredential(credential),
      baseUrl,
      timeoutMs: body.timeoutMs === undefined ? undefined : assertTimeoutMs(body.timeoutMs),
      inventorySyncEnabled: body.inventorySyncEnabled === undefined ? undefined : assertBoolean(body.inventorySyncEnabled, 'inventory_sync_enabled_invalid'),
      enabledCountryCodes: normalizeEnabledCountryCodes(providerCode, body.enabledCountryCodes),
    });

    await writeAudit(ctx, account.id, 'provider_account.create', {
      providerCode,
      baseUrl,
      timeoutMs: account.timeoutMs,
      inventorySyncEnabled: account.inventorySyncEnabled,
      enabledCountryCodes: account.enabledCountryCodes,
    });

    return this.toListItem(account);
  }

  @Put(':id')
  @RequireAuth()
  async update(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
    @Body() body: UpdateProviderAccountDto,
  ): Promise<ProviderAccountListItemDto> {
    requireProviderAdmin(ctx);
    assertRequestBody(body);
    const existing = await this.repo.findForSite(ctx.siteId, id);
    if (!existing) throw new AppError(ErrorCode.NOT_FOUND, 'provider_account_not_found', 404);
    const data: Partial<{
      status: 'ACTIVE' | 'DISABLED';
      credentialEncrypted: string;
      baseUrl: string;
      timeoutMs: number;
      inventorySyncEnabled: boolean;
      enabledCountryCodes: string[];
    }> = {};
    if (body.status !== undefined) data.status = assertProviderAccountStatus(body.status);
    if (body.credential !== undefined) {
      data.credentialEncrypted = this.encryptMergedCredential(existing.providerCode, existing.credentialEncrypted, body.credential);
    }
    if (body.baseUrl !== undefined) data.baseUrl = assertBaseUrl(existing.providerCode, body.baseUrl);
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

    const updated = await this.repo.update(ctx.siteId, id, data);
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND, 'provider_account_not_found', 404);
    const resourceConfigChangeReason = providerResourceConfigChangeReason(data);
    const resourceSelection = resourceConfigChangeReason
      ? await this.repo.hideProviderAccountResources(ctx.siteId, updated.providerCode, updated.id, resourceConfigChangeReason)
      : data.enabledCountryCodes === undefined
        ? null
        : await this.repo.applyEnabledCountrySelectionToResources(ctx.siteId, updated.providerCode, updated.enabledCountryCodes, updated.id);

    await writeAudit(ctx, id, 'provider_account.update', {
      changedFields: Object.keys(data).filter((key) => key !== 'credentialEncrypted').concat(data.credentialEncrypted ? ['credential'] : []),
      status: updated.status,
      baseUrl: updated.baseUrl,
      timeoutMs: updated.timeoutMs,
      inventorySyncEnabled: updated.inventorySyncEnabled,
      enabledCountryCodes: updated.enabledCountryCodes,
      resourceSelection,
    });

    return this.toListItem(updated);
  }

  @Put(':id/resources/saleability')
  @RequireAuth()
  async updateResourceSaleability(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
    @Body() body: ProviderResourceSaleabilityBody,
  ): Promise<ProviderAccountListItemDto> {
    requireProviderAdmin(ctx);
    const items = normalizeResourceSaleabilityItems(body);
    const result = await this.repo.updateResourceSaleability(ctx.siteId, id, items);

    await writeAudit(ctx, id, 'provider_account.resource_saleability.update', {
      updated: result.updated,
      enabledCountryCodes: result.enabledCountryCodes,
    });

    return this.toListItem(result.account);
  }

  private encryptCredential(credential: Record<string, string>): string {
    return encryptAesGcm(JSON.stringify(credential), this.config.get('APP_ENCRYPTION_KEY'));
  }

  private encryptMergedCredential(providerCode: ProviderCode, currentEncrypted: string, patch: unknown): string {
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

  private toListItem(record: ProviderAccountRecord): ProviderAccountListItemDto {
    const adapter = this.registry.getAdapter(record.providerCode);
    return {
      id: record.id,
      providerCode: record.providerCode,
      tenantId: record.tenantId,
      status: record.status,
      baseUrl: record.baseUrl,
      timeoutMs: record.timeoutMs,
      inventorySyncEnabled: record.inventorySyncEnabled,
      enabledCountryCodes: record.enabledCountryCodes,
      availableCountries: availableCountriesForProvider(record.providerCode),
      capabilities: deriveCapabilities(adapter, record.inventorySyncEnabled),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}

async function writeAudit(
  ctx: AuthenticatedContext,
  targetId: string,
  action: string,
  meta: Record<string, unknown>,
): Promise<void> {
  await prisma.audit_logs.create({
    data: {
      siteId: ctx.siteId,
      tenantId: null,
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

function assertProviderCode(value: unknown): ProviderCode {
  if (value === 'IPIPD' || value === 'NINE_EIGHT_FIVE' || value === 'PR' || value === 'UPSTREAM_API') return value;
  throw new AppError(ErrorCode.VALIDATION_ERROR, 'provider_code_invalid', 400);
}

function availableCountriesForProvider(providerCode: ProviderCode): Array<{ code: string; name: string }> {
  void providerCode;
  return [];
}

function normalizeEnabledCountryCodes(providerCode: ProviderCode, value: unknown): string[] {
  void providerCode;
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'enabled_country_codes_invalid', 400);
  }
  const normalized = value.map((item) => {
    if (typeof item !== 'string') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'enabled_country_codes_invalid', 400);
    }
    return item.trim().toUpperCase();
  }).filter(Boolean);
  const unique = [...new Set(normalized)];
  for (const code of unique) {
    if (!/^[A-Z]{2}$/.test(code)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'enabled_country_code_not_supported', 400);
    }
  }
  return unique;
}

function normalizeResourceSaleabilityItems(body: ProviderResourceSaleabilityBody): ProviderResourceSaleabilityChange[] {
  assertRequestBody(body);
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'resource_saleability_items_required', 400);
  }
  const changes = new Map<string, boolean>();
  for (const item of body.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'resource_saleability_item_invalid', 400);
    }
    const resourceId = item.resourceId;
    if (typeof resourceId !== 'string' || resourceId.trim() === '') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'resource_id_required', 400);
    }
    if (typeof item.saleable !== 'boolean') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'resource_saleability_invalid', 400);
    }
    changes.set(resourceId.trim(), item.saleable);
  }
  return [...changes.entries()].map(([resourceId, saleable]) => ({ resourceId, saleable }));
}

function assertProviderAccountStatus(value: unknown): 'ACTIVE' | 'DISABLED' {
  if (value === 'ACTIVE' || value === 'DISABLED') return value;
  throw new AppError(ErrorCode.VALIDATION_ERROR, 'provider_account_status_invalid', 400);
}

function providerResourceConfigChangeReason(data: Partial<{
  status: 'ACTIVE' | 'DISABLED';
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

function assertTimeoutMs(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1000 || numeric > 120000) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'provider_timeout_invalid', 400);
  }
  return numeric;
}

function assertBaseUrl(providerCode: ProviderCode, value: unknown): string {
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
