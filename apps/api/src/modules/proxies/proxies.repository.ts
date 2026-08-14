import { Injectable } from '@nestjs/common';
import { prisma, Prisma, ProxyStatus } from '@ipeasy/db';
import { PageQueryDto, PageResult, normalizePageQuery } from '../../common/pagination/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

export type ProxyInstance = Prisma.proxy_instancesGetPayload<Record<string, never>>;
type PrismaTransactionClient = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;
export type ProxyListQuery = PageQueryDto & {
  tenantId?: string;
  userId?: string;
  countryCode?: string;
  orderId?: string;
  status?: ProxyStatus;
};

@Injectable()
export class ProxiesRepository {
  async createMany(tx: PrismaTransactionClient, data: Prisma.proxy_instancesCreateManyInput[]): Promise<void> {
    await tx.proxy_instances.createMany({ data });
  }

  async findByUserId(userId: string, siteId: string, tenantId: string, query: ProxyListQuery): Promise<PageResult<ProxyInstance>> {
    const { page, pageSize } = normalizePageQuery(query);
    const where: Prisma.proxy_instancesWhereInput = { userId, siteId, tenantId };
    applyProxyFilters(where, query, 'USER');

    const [total, items] = await Promise.all([
      prisma.proxy_instances.count({ where }),
      prisma.proxy_instances.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { page, pageSize, total, items };
  }

  async listForAdmin(
    siteId: string,
    tenantId: string | null,
    query: ProxyListQuery,
  ): Promise<PageResult<ProxyInstance>> {
    const { page, pageSize } = normalizePageQuery(query);
    const where: Prisma.proxy_instancesWhereInput = { siteId };
    if (tenantId) where.tenantId = tenantId;
    applyProxyFilters(where, query, 'ADMIN');

    const [total, items] = await Promise.all([
      prisma.proxy_instances.count({ where }),
      prisma.proxy_instances.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { page, pageSize, total, items };
  }

  async findById(id: string): Promise<ProxyInstance | null> {
    return prisma.proxy_instances.findUnique({ where: { id } });
  }

  async findByOrderId(orderId: string, userId: string, tenantId: string): Promise<ProxyInstance[]> {
    return prisma.proxy_instances.findMany({
      where: { orderId, userId, tenantId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateStatus(id: string, status: ProxyStatus): Promise<ProxyInstance> {
    return prisma.proxy_instances.update({ where: { id }, data: { status } });
  }

  async findAllActiveByUserId(userId: string, siteId: string, tenantId: string): Promise<ProxyInstance[]> {
    return prisma.proxy_instances.findMany({
      where: { userId, siteId, tenantId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
  }
}

function applyProxyFilters(where: Prisma.proxy_instancesWhereInput, query: ProxyListQuery, scope: 'USER' | 'ADMIN'): void {
  if (query.status) where.status = query.status;
  if (query.countryCode) where.countryCode = query.countryCode;
  if (scope === 'ADMIN' && query.orderId) where.orderId = query.orderId;
  if (scope === 'ADMIN' && query.userId) where.userId = query.userId;
  const expiresAt = dateRange(query.from, query.to);
  if (expiresAt) where.expiresAt = expiresAt;
  if (query.search) {
    const contains = { contains: query.search, mode: 'insensitive' as const };
    where.OR = [
      { ip: contains },
      { orderId: contains },
      { upstreamProxyId: contains },
      { countryCode: contains },
      ...(scope === 'ADMIN' ? [{ userId: contains }] : []),
    ];
  }
}

function dateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  const range: Prisma.DateTimeFilter = {};
  if (from) range.gte = parseDate(from, 'from_invalid');
  if (to) range.lte = parseDate(to, 'to_invalid');
  return Object.keys(range).length > 0 ? range : undefined;
}

function parseDate(value: string, reasonKey: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400);
  }
  return date;
}
