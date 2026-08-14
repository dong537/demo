import { Injectable, Optional } from '@nestjs/common';
import { ProviderRegistryService } from '../../providers/provider-registry.service';
import { ResourcesRepository } from '../resources.repository';
import { ProviderCode } from '../../providers/provider.types';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { isManagedNativeProviderCode } from '../provider-saleability-policy';
import { inventoryFreshnessTtlSeconds } from '../inventory-freshness';
import { DedicatedLineInventoryRepository } from '../../dedicated-line-orders/dedicated-line-inventory.repository';

export interface SyncInventorySummary {
  attempted: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  synced: number;
  syncedAt: Date;
  upstreamRawStatus: 'SUCCESS';
  countries: string[];
}

type SyncedResourceCoverageKey = {
  code: string;
  ipType: 'NATIVE' | 'BROADCAST';
};

@Injectable()
export class SyncInventoryUseCase {
  constructor(
    private readonly registry: ProviderRegistryService,
    private readonly repo: ResourcesRepository,
    @Optional() private readonly dedicatedInventory?: DedicatedLineInventoryRepository,
  ) {}

  async execute(siteId: string, providerCode: ProviderCode, tenantId?: string | null, accountId?: string | null): Promise<SyncInventorySummary> {
    const config = accountId
      ? await this.registry.getConfigForProviderAccount(providerCode, siteId, accountId)
      : await this.registry.getConfig(providerCode, siteId, tenantId);
    if (config.status === 'DISABLED') {
      throw new AppError(ErrorCode.UPSTREAM_DISABLED, 'upstream_disabled', 422);
    }
    if (!config.inventorySyncEnabled) {
      throw new AppError(ErrorCode.UPSTREAM_DISABLED, 'inventory_sync_disabled', 503);
    }

    const adapter = this.registry.getAdapter(providerCode);
    const result = await adapter.syncInventory(config);
    if (result.providerCode !== providerCode) {
      throw new AppError(ErrorCode.UPSTREAM_ERROR, 'inventory_provider_mismatch', 502);
    }
    const upstreamAccountId = config.upstreamAccountId ?? accountId ?? null;
    const selectedCountryCodes = resolveSelectedCountryCodes(providerCode, config.enabledCountryCodes);
    const selectedCountrySet = selectedCountryCodes ? new Set(selectedCountryCodes) : null;
    const items = result.items;
    const hiddenByCountrySelection = selectedCountrySet
      ? result.items.filter((item) => !selectedCountrySet.has(normalizeCountryCode(item.countryCode))).length
      : 0;

    if (items.length === 0) {
      throw new AppError(ErrorCode.UPSTREAM_ERROR, 'inventory_empty', 502);
    }
    if (upstreamAccountId && this.dedicatedInventory) {
      await this.dedicatedInventory.syncProviderSnapshot({
        siteId,
        providerAccountId: upstreamAccountId,
        providerCode,
        items,
        capturedAt: result.syncedAt,
      });
    }

    const countries = new Set<string>();
    const allowedResources = new Map<string, SyncedResourceCoverageKey>();
    let created = 0;
    let updated = 0;
    const skipped = hiddenByCountrySelection;
    let synced = 0;
    for (const item of items) {
      const resourceCode = syncedResourceCode(item.countryCode, item.providerResourceId);
      const resourceName = syncedResourceName(item.countryName, item.regionCode, item.providerResourceId, item.networkCidr);
      const existing = await this.repo.findSyncedResource(siteId, providerCode, upstreamAccountId, resourceCode, item.ipType);
      const selectionData = resourceSelectionState(providerCode, item.countryCode, selectedCountrySet, existing?.unsaleableReason);
      const resource = await this.repo.upsertSyncedResource({
        siteId,
        providerCode,
        upstreamAccountId,
        code: resourceCode,
        name: resourceName,
        displayName: resourceName,
        type: resourceCode === item.countryCode ? 'COUNTRY' : 'REGION',
        ipType: item.ipType,
        protocol: item.protocol,
        providerResourceId: item.providerResourceId,
        upstreamCost: item.upstreamCost,
        upstreamCostCurrency: item.upstreamCostCurrency,
        saleabilityOverride: selectionData ?? undefined,
      });
      if (existing) {
        updated++;
      } else {
        created++;
      }

      await this.repo.upsertInventorySnapshot({
        siteId,
        resourceId: resource.id,
        providerCode,
        upstreamAccountId,
        stock: item.stock,
        capturedAt: result.syncedAt,
        freshnessTtlSeconds: inventoryFreshnessTtlSeconds(providerCode),
      });

      await this.repo.upsertMapping({
        siteId,
        resourceId: resource.id,
        providerCode,
        upstreamAccountId,
        providerResourceId: item.providerResourceId,
      });
      allowedResources.set(resourceCoverageKey(resourceCode, item.ipType), {
        code: resourceCode,
        ipType: item.ipType,
      });

      synced++;
      countries.add(item.countryCode);
    }

    if (isManagedNativeProviderCode(providerCode)) {
      await this.repo.disableResourcesOutsideCoverage(siteId, providerCode, upstreamAccountId, [...allowedResources.values()]);
    } else if (providerCode === 'UPSTREAM_API') {
      await this.repo.hideResourcesOutsideCurrentSync(siteId, providerCode, upstreamAccountId, [...allowedResources.values()]);
    }
    if (upstreamAccountId) {
      await this.repo.hideResourcesFromOtherUpstreamAccounts(siteId, providerCode, upstreamAccountId);
    }

    return {
      attempted: result.items.length,
      created,
      updated,
      skipped,
      failed: 0,
      synced,
      syncedAt: result.syncedAt,
      upstreamRawStatus: 'SUCCESS',
      countries: [...countries].sort(),
    };
  }

  async requiresRefreshForProviderConfig(
    siteId: string,
    providerCode: ProviderCode,
    tenantId: string | null | undefined,
    capturedAt: Date,
    accountId?: string | null,
  ): Promise<boolean> {
    const config = accountId
      ? await this.registry.getConfigForProviderAccount(providerCode, siteId, accountId)
      : await this.registry.getConfig(providerCode, siteId, tenantId);
    if (config.status !== 'ACTIVE' || !config.inventorySyncEnabled) return true;
    return Boolean(config.updatedAt && config.updatedAt.getTime() > capturedAt.getTime());
  }

  async resolveActiveUpstreamAccountId(
    siteId: string,
    providerCode: ProviderCode,
    tenantId: string | null | undefined,
  ): Promise<string | null> {
    const config = await this.registry.getConfig(providerCode, siteId, tenantId);
    if (config.status !== 'ACTIVE') {
      throw new AppError(ErrorCode.UPSTREAM_DISABLED, 'provider_disabled', 503);
    }
    if (!config.inventorySyncEnabled) {
      throw new AppError(ErrorCode.UPSTREAM_DISABLED, 'inventory_sync_disabled', 503);
    }
    return config.upstreamAccountId ?? null;
  }

}

function resolveSelectedCountryCodes(providerCode: ProviderCode, enabledCountryCodes: string[] | null | undefined): string[] | null {
  if (!isManagedNativeProviderCode(providerCode)) return null;
  return Array.isArray(enabledCountryCodes)
    ? enabledCountryCodes
      .filter((code) => typeof code === 'string' && code.trim())
      .map((code) => code.trim().toUpperCase())
    : [];
}

function resourceSelectionState(
  providerCode: ProviderCode,
  countryCode: string,
  selectedCountrySet: Set<string> | null,
  existingUnsaleableReason?: string | null,
): { status: 'HIDDEN'; isVisible: false; isSaleable: false; unsaleableReason: string } | null {
  if (existingUnsaleableReason === 'provider_sale_disabled') {
    return {
      status: 'HIDDEN',
      isVisible: false,
      isSaleable: false,
      unsaleableReason: 'provider_sale_disabled',
    };
  }
  if (!isManagedNativeProviderCode(providerCode) || !selectedCountrySet) return null;
  if (selectedCountrySet.has(normalizeCountryCode(countryCode))) return null;
  return {
    status: 'HIDDEN',
    isVisible: false,
    isSaleable: false,
    unsaleableReason: 'provider_country_disabled',
  };
}

function normalizeCountryCode(countryCode: string): string {
  return countryCode.trim().toUpperCase();
}

function syncedResourceCode(countryCode: string, providerResourceId: string): string {
  const country = normalizeCountryCode(countryCode);
  const upstream = providerResourceId.trim();
  if (!upstream || upstream === country) return country;
  if (upstream.toUpperCase().startsWith(`${country}:`)) return upstream;
  return `${country}:${upstream}`;
}

function resourceCoverageKey(code: string, ipType: string): string {
  return `${ipType}:${code}`;
}

function syncedResourceName(countryName: string, regionCode: string | undefined, providerResourceId: string, networkCidr?: string): string {
  const base = countryName.trim() || providerResourceId;
  const region = regionCode?.trim();
  const locationName = region && !base.includes(region) ? `${base}-${region}` : base;
  const cidr = networkCidr?.trim();
  return cidr ? `${locationName}-${cidr}` : locationName;
}
