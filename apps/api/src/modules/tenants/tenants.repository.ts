import { Injectable } from '@nestjs/common';
import { prisma, Prisma } from '@ipeasy/db';
import Decimal from 'decimal.js';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PageQueryDto, PageResult, normalizePageQuery } from '../../common/pagination/pagination.dto';

type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
type TenantWithUserCount = Prisma.tenantsGetPayload<{
  include: { _count: { select: { users: true } } };
}>;
type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type TenantListItem = {
  id: string;
  siteId: string;
  ownerUserId: string | null;
  code: string;
  name: string;
  status: TenantStatus;
  customerCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type CreatedTenantWithAdmin = TenantListItem & {
  adminUserId?: string;
};

export type TenantStats = {
  customerCount: number;
  orderCount: number;
  monthlyOrders: number;
  totalBalance: string;
  balanceByCurrency: Record<string, string>;
};

export type TenantDetail = TenantListItem & TenantStats;

export type TenantBrandConfig = {
  siteName: string;
  logoUrl?: string;
  primaryColor?: string;
  customDomain?: string;
  supportEmail?: string;
};

export type TenantBrand = TenantBrandConfig & {
  tenantId: string;
};

@Injectable()
export class TenantsRepository {
  async findAll(siteId: string, query: PageQueryDto = {}): Promise<PageResult<TenantListItem>> {
    const { page, pageSize } = normalizePageQuery(query);
    const where: Prisma.tenantsWhereInput = { siteId };
    if (query.status) {
      if (!isTenantStatus(query.status)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'tenant_status_invalid', 400);
      }
      where.status = query.status;
    }
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.tenants.count({ where }),
      prisma.tenants.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { users: true } } },
      }),
    ]);

    return {
      page,
      pageSize,
      total,
      items: rows.map((tenant: TenantWithUserCount) => ({
        id: tenant.id,
        siteId: tenant.siteId,
        ownerUserId: tenant.ownerUserId,
        code: tenant.code,
        name: tenant.name,
        status: tenant.status,
        customerCount: tenant._count.users,
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt,
      })),
    };
  }

  async findById(siteId: string, id: string): Promise<TenantListItem | null> {
    const tenant = await prisma.tenants.findFirst({
      where: { id, siteId },
      include: { _count: { select: { users: true } } },
    });
    if (!tenant) return null;
    return {
      id: tenant.id,
      siteId: tenant.siteId,
      ownerUserId: tenant.ownerUserId,
      code: tenant.code,
      name: tenant.name,
      status: tenant.status,
      customerCount: tenant._count.users,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
    };
  }

  async create(data: {
    siteId: string;
    code: string;
    name: string;
    adminEmail?: string;
    adminPasswordHash?: string;
    ownerUserId?: string;
  }): Promise<CreatedTenantWithAdmin> {
    const tenant = await prisma.$transaction(async (tx: PrismaTx) => {
      const createdTenant = await tx.tenants.create({
        data: {
          siteId: data.siteId,
          ownerUserId: data.ownerUserId,
          code: data.code,
          name: data.name,
          status: 'ACTIVE',
        },
      });
      const admin = data.adminEmail && data.adminPasswordHash
        ? await tx.admin_users.create({
          data: {
            siteId: data.siteId,
            tenantId: createdTenant.id,
            email: data.adminEmail,
            passwordHash: data.adminPasswordHash,
            role: 'TENANT_ADMIN',
            status: 'ACTIVE',
          },
          select: { id: true },
        })
        : null;
      return { tenant: createdTenant, adminUserId: admin?.id };
    });
    return { ...tenant.tenant, adminUserId: tenant.adminUserId, customerCount: 0 };
  }

  async findOwnedByUser(siteId: string, ownerUserId: string): Promise<TenantListItem | null> {
    const tenant = await prisma.tenants.findFirst({
      where: { siteId, ownerUserId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { users: true } } },
    });
    if (!tenant) return null;
    return {
      id: tenant.id,
      siteId: tenant.siteId,
      ownerUserId: tenant.ownerUserId,
      code: tenant.code,
      name: tenant.name,
      status: tenant.status,
      customerCount: tenant._count.users,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
    };
  }

  async adminEmailExists(email: string): Promise<boolean> {
    const [user, admin] = await Promise.all([
      prisma.users.findUnique({ where: { email }, select: { id: true } }),
      prisma.admin_users.findUnique({ where: { email }, select: { id: true } }),
    ]);
    return Boolean(user || admin);
  }

  async updateStatus(siteId: string, id: string, status: 'ACTIVE' | 'SUSPENDED'): Promise<TenantListItem> {
    const updated = await prisma.tenants.updateMany({ where: { id, siteId }, data: { status } });
    if (updated.count === 0) {
      throw new AppError(ErrorCode.NOT_FOUND, 'tenant_not_found', 404);
    }
    const tenant = await this.findById(siteId, id);
    if (!tenant) throw new AppError(ErrorCode.NOT_FOUND, 'tenant_not_found', 404);
    return tenant;
  }

  async findBrandById(id: string): Promise<TenantBrand | null> {
    const tenant = await prisma.tenants.findUnique({
      where: { id },
      select: { id: true, name: true, brandConfig: true },
    });
    return tenant ? toTenantBrand(tenant) : null;
  }

  async updateBrandConfig(
    siteId: string,
    id: string,
    brandConfig: TenantBrandConfig,
  ): Promise<TenantBrand | null> {
    const existing = await prisma.tenants.findFirst({
      where: { id, siteId },
      select: { id: true },
    });
    if (!existing) return null;

    const tenant = await prisma.tenants.update({
      where: { id: existing.id },
      data: { brandConfig: brandConfig as Prisma.InputJsonObject },
      select: { id: true, name: true, brandConfig: true },
    });
    return toTenantBrand(tenant);
  }

  async getTenantStats(siteId: string, id: string, platformCurrency: string): Promise<TenantStats> {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [customerCount, orderCount, monthlyOrders, wallets] = await Promise.all([
      prisma.users.count({ where: { siteId, tenantId: id } }),
      prisma.orders.count({ where: { siteId, tenantId: id } }),
      prisma.orders.count({ where: { siteId, tenantId: id, createdAt: { gte: monthStart } } }),
      prisma.wallets.findMany({ where: { siteId, tenantId: id }, select: { available: true, currency: true } }),
    ]);

    const balanceByCurrency: Record<string, string> = {};
    for (const w of wallets) {
      const cur = w.currency;
      const prev = new Decimal(balanceByCurrency[cur] ?? '0');
      balanceByCurrency[cur] = prev.plus(w.available.toString()).toFixed();
    }

    return {
      customerCount,
      orderCount,
      monthlyOrders,
      totalBalance: balanceByCurrency[platformCurrency] ?? '0',
      balanceByCurrency,
    };
  }
}

function isTenantStatus(value: string): value is TenantStatus {
  return ['ACTIVE', 'SUSPENDED', 'CLOSED'].includes(value);
}

function toTenantBrand(row: {
  id: string;
  name: string;
  brandConfig: Prisma.JsonValue | null;
}): TenantBrand {
  return {
    tenantId: row.id,
    ...readStoredBrandConfig(row.brandConfig, row.name),
  };
}

function readStoredBrandConfig(value: Prisma.JsonValue | null, tenantName: string): TenantBrandConfig {
  if (value === null) return { siteName: tenantName };
  if (!isJsonObject(value)) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'tenant_brand_config_invalid', 500);
  }

  const siteName = readRequiredString(value, 'siteName');
  const brand: TenantBrandConfig = { siteName };
  const logoUrl = readOptionalString(value, 'logoUrl');
  const primaryColor = readOptionalString(value, 'primaryColor');
  const customDomain = readOptionalString(value, 'customDomain');
  const supportEmail = readOptionalString(value, 'supportEmail');
  if (logoUrl !== undefined) brand.logoUrl = logoUrl;
  if (primaryColor !== undefined) brand.primaryColor = primaryColor;
  if (customDomain !== undefined) brand.customDomain = customDomain;
  if (supportEmail !== undefined) brand.supportEmail = supportEmail;
  return brand;
}

function isJsonObject(value: Prisma.JsonValue): value is Record<string, Prisma.JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRequiredString(value: Record<string, Prisma.JsonValue>, field: string): string {
  const item = value[field];
  if (typeof item !== 'string' || item.trim() === '') {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'tenant_brand_config_invalid', 500);
  }
  return item;
}

function readOptionalString(value: Record<string, Prisma.JsonValue>, field: string): string | undefined {
  const item = value[field];
  if (item === undefined) return undefined;
  if (typeof item !== 'string' || item.trim() === '') {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'tenant_brand_config_invalid', 500);
  }
  return item;
}
