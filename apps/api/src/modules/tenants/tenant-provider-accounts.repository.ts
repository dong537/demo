import { Injectable } from '@nestjs/common';
import { prisma, Prisma } from '@ipeasy/db';
import { ProviderCode } from '../providers/provider.types';
import { CURRENT_PROVIDER_ACCOUNT_ORDER_BY } from '../providers/provider-account-order';

export type NativeProviderCode = Exclude<ProviderCode, 'UPSTREAM_API'>;
export type TenantProviderAccountStatus = 'ACTIVE' | 'DISABLED';

export type TenantProviderAccountItem = {
  id: string;
  siteId: string;
  tenantId: string | null;
  providerCode: NativeProviderCode;
  status: TenantProviderAccountStatus;
  credentialEncrypted: string;
  baseUrl: string;
  timeoutMs: number;
  inventorySyncEnabled: boolean;
  enabledCountryCodes: string[];
  createdAt: Date;
  updatedAt: Date;
};

type CreateTenantProviderAccountData = {
  siteId: string;
  tenantId: string;
  providerCode: NativeProviderCode;
  status?: TenantProviderAccountStatus;
  credentialEncrypted: string;
  baseUrl: string;
  timeoutMs?: number;
  inventorySyncEnabled?: boolean;
  enabledCountryCodes?: string[];
};

type UpdateTenantProviderAccountData = Partial<{
  status: TenantProviderAccountStatus;
  credentialEncrypted: string;
  baseUrl: string;
  timeoutMs: number;
  inventorySyncEnabled: boolean;
  enabledCountryCodes: string[];
}>;

@Injectable()
export class TenantProviderAccountsRepository {
  async list(siteId: string, tenantId: string): Promise<TenantProviderAccountItem[]> {
    const rows = await prisma.provider_accounts.findMany({
      where: { siteId, tenantId },
      orderBy: [{ providerCode: 'asc' }, ...CURRENT_PROVIDER_ACCOUNT_ORDER_BY],
    });
    return rows.map(toTenantProviderAccountItem);
  }

  async findById(siteId: string, tenantId: string, accountId: string): Promise<TenantProviderAccountItem | null> {
    const row = await prisma.provider_accounts.findFirst({ where: { id: accountId, siteId, tenantId } });
    return row ? toTenantProviderAccountItem(row) : null;
  }

  async create(data: CreateTenantProviderAccountData): Promise<TenantProviderAccountItem> {
    const row = await prisma.provider_accounts.create({
      data: {
        ...data,
        status: data.status ?? 'ACTIVE',
      },
    });
    return toTenantProviderAccountItem(row);
  }

  async update(siteId: string, tenantId: string, accountId: string, data: UpdateTenantProviderAccountData): Promise<TenantProviderAccountItem | null> {
    const existing = await prisma.provider_accounts.findFirst({
      where: { id: accountId, siteId, tenantId },
      select: { id: true },
    });
    if (!existing) return null;

    const row = await prisma.provider_accounts.update({
      where: { id: existing.id },
      data,
    });
    return toTenantProviderAccountItem(row);
  }

  async disable(siteId: string, tenantId: string, accountId: string): Promise<TenantProviderAccountItem | null> {
    return this.update(siteId, tenantId, accountId, { status: 'DISABLED' });
  }
}

function toTenantProviderAccountItem(row: Prisma.provider_accountsGetPayload<object>): TenantProviderAccountItem {
  return {
    id: row.id,
    siteId: row.siteId,
    tenantId: row.tenantId,
    providerCode: row.providerCode as NativeProviderCode,
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
