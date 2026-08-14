import { Injectable } from '@nestjs/common';
import { prisma, Prisma } from '@ipeasy/db';
import { ProviderCode } from './provider.types';
import {
  getProviderResourceSaleability,
  isManagedNativeProviderCode,
} from '../resources/provider-saleability-policy';
import { resourceCountryCode } from '../pricing/base-price';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { CURRENT_PROVIDER_ACCOUNT_ORDER_BY } from './provider-account-order';

/**
 * Internal record for a provider account, including the encrypted credential.
 * Stays inside the backend; the credential is only ever used to build a runtime
 * config for a live probe and is never mapped into a response DTO.
 */
export interface ProviderAccountRecord {
  id: string;
  siteId: string;
  tenantId: string | null;
  providerCode: ProviderCode;
  status: 'ACTIVE' | 'DISABLED';
  credentialEncrypted: string;
  baseUrl: string;
  timeoutMs: number;
  inventorySyncEnabled: boolean;
  enabledCountryCodes: string[];
  createdAt: Date;
  updatedAt: Date;
}

export type ProviderAccountSyncRecord = Pick<
    ProviderAccountRecord,
  'id' | 'siteId' | 'tenantId' | 'providerCode' | 'status' | 'inventorySyncEnabled' | 'enabledCountryCodes'
>;

export type ProviderResourceSelectionPlan = {
  total: number;
  saleable: number;
  hiddenByCountry: number;
  hiddenByPolicy: number;
  hiddenByManual: number;
  hidden: number;
  changed: number;
  saleableIds: string[];
  hiddenByCountryIds: string[];
  hiddenByPolicyIds: string[];
  hiddenByManualIds: string[];
};

export type ProviderResourceSaleabilityChange = {
  resourceId: string;
  saleable: boolean;
};

export type ProviderResourceSaleabilityUpdateResult = {
  account: ProviderAccountRecord;
  updated: number;
  enabledCountryCodes: string[];
};

type ResourceSaleabilityState = {
  status: 'ACTIVE' | 'HIDDEN';
  isVisible: boolean;
  isSaleable: boolean;
  unsaleableReason: string | null;
};

type ProviderResourceSaleabilityRow = Prisma.platform_resourcesGetPayload<{
  select: {
    id: true;
    code: true;
    name: true;
    displayName: true;
    status: true;
    isVisible: true;
    isSaleable: true;
    unsaleableReason: true;
    resource_mappings: {
      select: { providerResourceId: true };
      orderBy: { weight: 'desc' };
      take: 1;
    };
  };
}>;

/**
 * Read access to `provider_accounts` for the platform provider-health panel.
 * Listing is scoped to a site (PLATFORM_ADMIN); `findForSite` enforces the same
 * site boundary so a cross-site id resolves to "not found".
 */
@Injectable()
export class ProvidersRepository {
  async listForSite(siteId: string): Promise<ProviderAccountRecord[]> {
    const rows = await prisma.provider_accounts.findMany({
      where: { siteId },
      orderBy: [{ providerCode: 'asc' }, ...CURRENT_PROVIDER_ACCOUNT_ORDER_BY],
    });
    return rows.map(toRecord);
  }

  async findForSite(siteId: string, id: string): Promise<ProviderAccountRecord | null> {
    const row = await prisma.provider_accounts.findFirst({ where: { id, siteId } });
    return row ? toRecord(row) : null;
  }

  async listInventorySyncEnabled(): Promise<ProviderAccountSyncRecord[]> {
    const rows = await prisma.provider_accounts.findMany({
      select: {
        id: true,
        siteId: true,
        tenantId: true,
        providerCode: true,
        status: true,
        inventorySyncEnabled: true,
        enabledCountryCodes: true,
      },
      orderBy: [{ siteId: 'asc' }, { tenantId: 'asc' }, { providerCode: 'asc' }, ...CURRENT_PROVIDER_ACCOUNT_ORDER_BY],
    });
    const latestByScope = new Map<string, ProviderAccountSyncRecord>();
    for (const row of rows) {
      const key = `${row.siteId}:${row.tenantId ?? ''}:${row.providerCode}`;
      if (latestByScope.has(key)) continue;
      latestByScope.set(key, {
        id: row.id,
        siteId: row.siteId,
        tenantId: row.tenantId,
        providerCode: row.providerCode as ProviderCode,
        status: row.status,
        inventorySyncEnabled: row.inventorySyncEnabled,
        enabledCountryCodes: row.enabledCountryCodes,
      });
    }
    return [...latestByScope.values()].filter((row) => row.status === 'ACTIVE' && row.inventorySyncEnabled);
  }

  async create(data: {
    siteId: string;
    providerCode: ProviderCode;
    status: 'ACTIVE' | 'DISABLED';
    credentialEncrypted: string;
    baseUrl: string;
    timeoutMs?: number;
    inventorySyncEnabled?: boolean;
    enabledCountryCodes?: string[];
  }): Promise<ProviderAccountRecord> {
    const row = await prisma.provider_accounts.create({
      data: {
        siteId: data.siteId,
        providerCode: data.providerCode,
        status: data.status,
        credentialEncrypted: data.credentialEncrypted,
        baseUrl: data.baseUrl,
        timeoutMs: data.timeoutMs,
        inventorySyncEnabled: data.inventorySyncEnabled,
        enabledCountryCodes: data.enabledCountryCodes,
      },
    });
    return toRecord(row);
  }

  async update(
    siteId: string,
    id: string,
    data: Partial<{
      status: 'ACTIVE' | 'DISABLED';
      credentialEncrypted: string;
      baseUrl: string;
      timeoutMs: number;
      inventorySyncEnabled: boolean;
      enabledCountryCodes: string[];
    }>,
  ): Promise<ProviderAccountRecord | null> {
    const existing = await prisma.provider_accounts.findFirst({ where: { id, siteId }, select: { id: true } });
    if (!existing) return null;
    const row = await prisma.provider_accounts.update({
      where: { id: existing.id },
      data,
    });
    return toRecord(row);
  }

  async updateResourceSaleability(
    siteId: string,
    providerAccountId: string,
    items: ProviderResourceSaleabilityChange[],
  ): Promise<ProviderResourceSaleabilityUpdateResult> {
    const account = await this.findForSite(siteId, providerAccountId);
    if (!account) throw new AppError(ErrorCode.NOT_FOUND, 'provider_account_not_found', 404);

    const changeByResource = new Map(items.map((item) => [item.resourceId, item.saleable]));
    const resourceIds = [...changeByResource.keys()];
    if (resourceIds.length === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'resource_saleability_items_required', 400);
    }

    const resources = await prisma.platform_resources.findMany({
      where: {
        siteId,
        providerCode: account.providerCode,
        upstreamAccountId: account.id,
      },
      select: {
        id: true,
        code: true,
        name: true,
        displayName: true,
        status: true,
        isVisible: true,
        isSaleable: true,
        unsaleableReason: true,
        resource_mappings: {
          select: { providerResourceId: true },
          orderBy: { weight: 'desc' },
          take: 1,
        },
      },
    });
    const resourceById = new Map(resources.map((resource) => [resource.id, resource]));
    if (resourceIds.some((resourceId) => !resourceById.has(resourceId))) {
      throw new AppError(ErrorCode.NOT_FOUND, 'resource_not_found', 404);
    }

    const finalStateByResource = new Map<string, ResourceSaleabilityState>();
    for (const resource of resources) {
      const requestedSaleable = changeByResource.get(resource.id);
      finalStateByResource.set(
        resource.id,
        requestedSaleable === undefined
          ? currentSaleabilityState(resource)
          : nextRequestedSaleabilityState(account.providerCode, resource, requestedSaleable),
      );
    }
    const enabledCountryCodes = [...new Set(resources
      .filter((resource) => isSaleabilityEnabled(finalStateByResource.get(resource.id)))
      .map((resource) => resourceCountryCode(resource.code)))]
      .sort();

    const resourceUpdates = resourceIds.map((resourceId) => {
      const state = finalStateByResource.get(resourceId);
      if (!state) throw new AppError(ErrorCode.NOT_FOUND, 'resource_not_found', 404);
      return prisma.platform_resources.update({ where: { id: resourceId }, data: state });
    });
    const writes = [
      ...resourceUpdates,
      prisma.provider_accounts.update({
        where: { id: account.id },
        data: { enabledCountryCodes },
      }),
    ];
    const results = await prisma.$transaction(writes);
    const updatedAccount = results[results.length - 1] as Prisma.provider_accountsGetPayload<object>;

    return {
      account: toRecord(updatedAccount),
      updated: resourceIds.length,
      enabledCountryCodes,
    };
  }

  async applyEnabledCountrySelectionToResources(
    siteId: string,
    providerCode: ProviderCode,
    enabledCountryCodes: string[],
    upstreamAccountId?: string | null,
  ): Promise<{ updated: number; saleable: number; hidden: number }> {
    const plan = await this.planEnabledCountrySelectionToResources(siteId, providerCode, enabledCountryCodes, upstreamAccountId);

    const writes: Prisma.PrismaPromise<unknown>[] = [];
    if (plan.saleableIds.length > 0) {
      writes.push(prisma.platform_resources.updateMany({
        where: { siteId, id: { in: plan.saleableIds } },
        data: {
          status: 'ACTIVE',
          isVisible: true,
          isSaleable: true,
          unsaleableReason: null,
        },
      }));
    }
    if (plan.hiddenByPolicyIds.length > 0) {
      writes.push(prisma.platform_resources.updateMany({
        where: { siteId, id: { in: plan.hiddenByPolicyIds } },
        data: {
          status: 'HIDDEN',
          isVisible: false,
          isSaleable: false,
          unsaleableReason: 'provider_sale_policy_disabled',
        },
      }));
    }
    if (plan.hiddenByCountryIds.length > 0) {
      writes.push(prisma.platform_resources.updateMany({
        where: { siteId, id: { in: plan.hiddenByCountryIds } },
        data: {
          status: 'HIDDEN',
          isVisible: false,
          isSaleable: false,
          unsaleableReason: 'provider_country_disabled',
        },
      }));
    }
    if (plan.hiddenByManualIds.length > 0) {
      writes.push(prisma.platform_resources.updateMany({
        where: { siteId, id: { in: plan.hiddenByManualIds } },
        data: {
          status: 'HIDDEN',
          isVisible: false,
          isSaleable: false,
          unsaleableReason: 'provider_sale_disabled',
        },
      }));
    }
    if (writes.length > 0) await prisma.$transaction(writes);
    return { updated: plan.total, saleable: plan.saleable, hidden: plan.hidden };
  }

  async planEnabledCountrySelectionToResources(
    siteId: string,
    providerCode: ProviderCode,
    enabledCountryCodes: string[],
    upstreamAccountId?: string | null,
  ): Promise<ProviderResourceSelectionPlan> {
    const selectedCountries = resolveSelectedCountries(providerCode, enabledCountryCodes);
    const resources = await prisma.platform_resources.findMany({
      where: {
        siteId,
        providerCode,
        ...(upstreamAccountId !== undefined ? { upstreamAccountId } : {}),
        OR: [
          { status: { not: 'DISABLED' } },
          { unsaleableReason: { in: ['provider_country_disabled', 'provider_country_not_supported', 'provider_sale_disabled'] } },
        ],
      },
      select: {
        id: true,
        code: true,
        name: true,
        displayName: true,
        status: true,
        isVisible: true,
        isSaleable: true,
        unsaleableReason: true,
        resource_mappings: {
          select: { providerResourceId: true },
          orderBy: { weight: 'desc' },
          take: 1,
        },
      },
    });

    const saleableIds: string[] = [];
    const hiddenByCountryIds: string[] = [];
    const hiddenByPolicyIds: string[] = [];
    const hiddenByManualIds: string[] = [];
    let changed = 0;
    for (const resource of resources) {
      const countrySelected = selectedCountries === null || selectedCountries.has(resourceCountryCode(resource.code));
      const policy = getProviderResourceSaleability({
        providerCode,
        code: resource.code,
        name: resource.name,
        displayName: resource.displayName,
        providerResourceId: resource.resource_mappings?.[0]?.providerResourceId,
      });
      const manuallyHidden =
        countrySelected
        && policy.saleable
        && resource.status === 'HIDDEN'
        && resource.isVisible === false
        && resource.isSaleable === false
        && resource.unsaleableReason === 'provider_sale_disabled';
      const isSaleable = countrySelected && policy.saleable;
      if (manuallyHidden) {
        hiddenByManualIds.push(resource.id);
        if (
          resource.status !== 'HIDDEN'
          || resource.isVisible
          || resource.isSaleable
          || resource.unsaleableReason !== 'provider_sale_disabled'
        ) {
          changed++;
        }
      } else if (isSaleable) {
        saleableIds.push(resource.id);
        if (resource.status !== 'ACTIVE' || !resource.isVisible || !resource.isSaleable || resource.unsaleableReason !== null) {
          changed++;
        }
      } else if (countrySelected) {
        hiddenByPolicyIds.push(resource.id);
        if (
          resource.status !== 'HIDDEN'
          || resource.isVisible
          || resource.isSaleable
          || resource.unsaleableReason !== 'provider_sale_policy_disabled'
        ) {
          changed++;
        }
      } else {
        hiddenByCountryIds.push(resource.id);
        if (
          resource.status !== 'HIDDEN'
          || resource.isVisible
          || resource.isSaleable
          || resource.unsaleableReason !== 'provider_country_disabled'
        ) {
          changed++;
        }
      }
    }

    return {
      total: resources.length,
      saleable: saleableIds.length,
      hiddenByCountry: hiddenByCountryIds.length,
      hiddenByPolicy: hiddenByPolicyIds.length,
      hiddenByManual: hiddenByManualIds.length,
      hidden: hiddenByPolicyIds.length + hiddenByCountryIds.length + hiddenByManualIds.length,
      changed,
      saleableIds,
      hiddenByCountryIds,
      hiddenByPolicyIds,
      hiddenByManualIds,
    };
  }

  hideProviderAccountResources(
    siteId: string,
    providerCode: ProviderCode,
    upstreamAccountId: string,
    reason: string,
  ): Promise<Prisma.BatchPayload> {
    return prisma.platform_resources.updateMany({
      where: {
        siteId,
        providerCode,
        OR: [
          { upstreamAccountId },
          { upstreamAccountId: null },
        ],
        status: { not: 'DISABLED' },
      },
      data: {
        status: 'HIDDEN',
        isVisible: false,
        isSaleable: false,
        unsaleableReason: reason,
      },
    });
  }
}

function resolveSelectedCountries(providerCode: ProviderCode, enabledCountryCodes: string[]): Set<string> | null {
  const normalized = enabledCountryCodes.map((code) => code.trim().toUpperCase()).filter(Boolean);
  if (normalized.length > 0) return new Set(normalized);
  if (isManagedNativeProviderCode(providerCode)) return new Set();
  return null;
}

function nextRequestedSaleabilityState(
  providerCode: ProviderCode,
  resource: ProviderResourceSaleabilityRow,
  requestedSaleable: boolean,
): ResourceSaleabilityState {
  const policy = getProviderResourceSaleability({
    providerCode,
    code: resource.code,
    name: resource.name,
    displayName: resource.displayName,
    providerResourceId: resource.resource_mappings?.[0]?.providerResourceId,
  });
  if (requestedSaleable && policy.saleable) {
    return {
      status: 'ACTIVE',
      isVisible: true,
      isSaleable: true,
      unsaleableReason: null,
    };
  }
  return {
    status: 'HIDDEN',
    isVisible: false,
    isSaleable: false,
    unsaleableReason: saleabilityDisabledReason(requestedSaleable),
  };
}

function currentSaleabilityState(resource: ProviderResourceSaleabilityRow): ResourceSaleabilityState {
  return {
    status: resource.status === 'ACTIVE' ? 'ACTIVE' : 'HIDDEN',
    isVisible: resource.isVisible,
    isSaleable: resource.isSaleable,
    unsaleableReason: resource.unsaleableReason,
  };
}

function isSaleabilityEnabled(state: ResourceSaleabilityState | undefined): boolean {
  return Boolean(state && state.status === 'ACTIVE' && state.isVisible && state.isSaleable);
}

function saleabilityDisabledReason(requestedSaleable: boolean): string {
  if (!requestedSaleable) return 'provider_sale_disabled';
  return 'provider_sale_policy_disabled';
}

function toRecord(row: Prisma.provider_accountsGetPayload<object>): ProviderAccountRecord {
  return {
    id: row.id,
    siteId: row.siteId,
    tenantId: row.tenantId,
    providerCode: row.providerCode as ProviderCode,
    status: row.status,
    credentialEncrypted: row.credentialEncrypted,
    baseUrl: row.baseUrl,
    timeoutMs: row.timeoutMs,
    inventorySyncEnabled: row.inventorySyncEnabled,
    enabledCountryCodes: row.enabledCountryCodes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
