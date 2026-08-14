import { Injectable } from '@nestjs/common';
import { prisma, Prisma } from '@ipeasy/db';
import { PageQueryDto, PageResult, normalizePageQuery } from '../../common/pagination/pagination.dto';
import { CURRENT_UPSTREAM_API_ACCOUNT_ORDER_BY } from '../providers/provider-account-order';

export type UpstreamAccountListItem = {
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
};

@Injectable()
export class UpstreamAccountsRepository {
  async listForSite(siteId: string, query: PageQueryDto = {}): Promise<PageResult<UpstreamAccountListItem>> {
    const { page, pageSize } = normalizePageQuery(query);
    return this.listPage({ siteId }, page, pageSize);
  }

  async listForTenant(siteId: string, tenantId: string, query: PageQueryDto = {}): Promise<PageResult<UpstreamAccountListItem>> {
    const { page, pageSize } = normalizePageQuery(query);
    return this.listPage({
      siteId,
      OR: [{ tenantId }, { tenantId: null }],
    }, page, pageSize);
  }

  async findBySiteId(siteId: string) {
    return prisma.upstream_api_accounts.findMany({ where: { siteId }, orderBy: CURRENT_UPSTREAM_API_ACCOUNT_ORDER_BY });
  }

  async findPublic(siteId: string) {
    return prisma.upstream_api_accounts.findMany({ where: { siteId, tenantId: null }, orderBy: CURRENT_UPSTREAM_API_ACCOUNT_ORDER_BY });
  }

  async findByTenantId(siteId: string, tenantId: string) {
    return prisma.upstream_api_accounts.findMany({ where: { siteId, tenantId }, orderBy: CURRENT_UPSTREAM_API_ACCOUNT_ORDER_BY });
  }

  async findById(id: string) {
    return prisma.upstream_api_accounts.findUnique({ where: { id } });
  }

  /** Returns the best upstream account for fulfillment: tenant-specific first, then public */
  async findForFulfillment(siteId: string, tenantId: string) {
    const tenant = await prisma.upstream_api_accounts.findFirst({
      where: { siteId, tenantId, status: 'ACTIVE' },
      orderBy: CURRENT_UPSTREAM_API_ACCOUNT_ORDER_BY,
    });
    if (tenant) return tenant;
    return prisma.upstream_api_accounts.findFirst({
      where: { siteId, tenantId: null, status: 'ACTIVE' },
      orderBy: CURRENT_UPSTREAM_API_ACCOUNT_ORDER_BY,
    });
  }

  async create(data: {
    siteId: string;
    tenantId: string | null;
    name: string;
    baseUrl: string;
    apiKeyEncrypted: string;
    timeoutMs?: number;
    inventorySyncEnabled?: boolean;
  }) {
    return prisma.upstream_api_accounts.create({ data: { ...data, status: 'ACTIVE' } });
  }

  async update(id: string, data: Partial<{ name: string; baseUrl: string; apiKeyEncrypted: string; timeoutMs: number; inventorySyncEnabled: boolean }>) {
    return prisma.upstream_api_accounts.update({ where: { id }, data });
  }

  /** Soft-disable */
  async disable(id: string) {
    return prisma.upstream_api_accounts.update({ where: { id }, data: { status: 'DISABLED' } });
  }

  private async listPage(
    where: Prisma.upstream_api_accountsWhereInput,
    page: number,
    pageSize: number,
  ): Promise<PageResult<UpstreamAccountListItem>> {
    const [total, rows] = await Promise.all([
      prisma.upstream_api_accounts.count({ where }),
      prisma.upstream_api_accounts.findMany({
        where,
        orderBy: CURRENT_UPSTREAM_API_ACCOUNT_ORDER_BY,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          siteId: true,
          tenantId: true,
          name: true,
          baseUrl: true,
          status: true,
          timeoutMs: true,
          inventorySyncEnabled: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);
    return { page, pageSize, total, items: rows };
  }
}
