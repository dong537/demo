import { Injectable } from '@nestjs/common';
import { prisma, Prisma, OrderStatus } from '@ipeasy/db';
import { PageQueryDto, PageResult, normalizePageQuery } from '../../common/pagination/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

export type Order = Prisma.ordersGetPayload<Record<string, never>>;
export type AdminOrderListItem = Order & {
  tenantCode: string | null;
  tenantName: string | null;
  tenantAdminId: string | null;
  tenantAdminEmail: string | null;
  userEmail: string | null;
  providerCode: string | null;
  upstreamOrderId: string | null;
  failureStage: string | null;
  failureError: string | null;
  resource: {
    id: string;
    code: string;
    name: string;
    displayName: string | null;
    providerCode: string;
  } | null;
};
export type OrderFulfillmentDetail = {
  taskStatus: string;
  upstreamImage: string;
  proxies: Array<{
    id: string;
    ip: string;
    port: number;
    status: string;
    expiresAt: Date;
  }>;
  operationLogs: Array<{
    id: string;
    action: string;
    actorType: string;
    actorId: string;
    reason: string | null;
    requestId: string;
    meta: Prisma.JsonValue | null;
    createdAt: Date;
  }>;
};
type PrismaTransactionClient = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

@Injectable()
export class OrdersRepository {
  async create(tx: PrismaTransactionClient, data: Prisma.ordersCreateInput): Promise<Order> {
    return tx.orders.create({ data });
  }

  async findById(id: string): Promise<Order | null> {
    return prisma.orders.findUnique({ where: { id } });
  }

  async getByIdForScope(id: string, siteId: string, tenantId: string | null): Promise<Order> {
    const where: Prisma.ordersWhereInput = { id, siteId };
    if (tenantId) where.tenantId = tenantId;
    const order = await prisma.orders.findFirst({ where });
    if (!order) throw new AppError(ErrorCode.NOT_FOUND, 'order_not_found', 404);
    return order;
  }

  async findByIdempotencyKey(key: string): Promise<Order | null> {
    return prisma.orders.findFirst({ where: { idempotencyKey: key } });
  }

  async findByIdempotencyKeyForUser(key: string, siteId: string, tenantId: string, userId: string): Promise<Order | null> {
    return prisma.orders.findUnique({
      where: {
        siteId_tenantId_userId_idempotencyKey: {
          siteId,
          tenantId,
          userId,
          idempotencyKey: key,
        },
      },
    });
  }

  async updateStatus(id: string, status: OrderStatus, failReason?: string): Promise<Order> {
    return prisma.orders.update({ where: { id }, data: { status, ...(failReason ? { failReason } : {}) } });
  }

  async list(
    userId: string,
    tenantId: string,
    query: PageQueryDto,
  ): Promise<PageResult<Order>> {
    const { page, pageSize } = normalizePageQuery(query);
    const where: Prisma.ordersWhereInput = { userId, tenantId };
    if (query.status) where.status = query.status as OrderStatus;

    const [total, items] = await Promise.all([
      prisma.orders.count({ where }),
      prisma.orders.findMany({
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
    query: PageQueryDto & { userId?: string; status?: OrderStatus },
  ): Promise<PageResult<AdminOrderListItem>> {
    const { page, pageSize } = normalizePageQuery(query);
    const where: Prisma.ordersWhereInput = { siteId };
    if (tenantId) where.tenantId = tenantId;
    if (query.userId) where.userId = query.userId;
    if (query.status) where.status = query.status;
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { id: { contains: search, mode: 'insensitive' } },
        { userId: { contains: search, mode: 'insensitive' } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
        { resource: { code: { contains: search, mode: 'insensitive' } } },
        { resource: { name: { contains: search, mode: 'insensitive' } } },
        { resource: { displayName: { contains: search, mode: 'insensitive' } } },
        { upstream_order_mirrors: { some: { upstreamOrderId: { contains: search, mode: 'insensitive' } } } },
      ];

      const matchingTenantIds = await prisma.tenants.findMany({
        where: {
          siteId,
          ...(tenantId ? { id: tenantId } : {}),
          OR: [
            { code: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      if (matchingTenantIds.length > 0) {
        where.OR.push({ tenantId: { in: matchingTenantIds.map((tenant) => tenant.id) } });
      }
    }

    const [total, items] = await Promise.all([
      prisma.orders.count({ where }),
      prisma.orders.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { email: true } },
          resource: { select: { id: true, code: true, name: true, displayName: true, providerCode: true } },
          fulfillment_jobs: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { providerCode: true, status: true, lastError: true },
          },
          upstream_order_mirrors: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { providerCode: true, upstreamOrderId: true, status: true },
          },
        },
      }),
    ]);
    return { page, pageSize, total, items: await this.toAdminOrderListItems(siteId, items) };
  }

  private async toAdminOrderListItems(
    siteId: string,
    orders: Array<Prisma.ordersGetPayload<{
      include: {
        user: { select: { email: true } };
        resource: { select: { id: true; code: true; name: true; displayName: true; providerCode: true } };
        fulfillment_jobs: {
          select: { providerCode: true; status: true; lastError: true };
        };
        upstream_order_mirrors: {
          select: { providerCode: true; upstreamOrderId: true; status: true };
        };
      };
    }>>,
  ): Promise<AdminOrderListItem[]> {
    if (orders.length === 0) return [];

    const tenantIds = Array.from(new Set(orders.map((order) => order.tenantId)));
    const [tenants, tenantAdmins] = await Promise.all([
      prisma.tenants.findMany({
        where: { siteId, id: { in: tenantIds } },
        select: { id: true, code: true, name: true },
      }),
      prisma.admin_users.findMany({
        where: { siteId, tenantId: { in: tenantIds }, role: 'TENANT_ADMIN', status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
        select: { id: true, tenantId: true, email: true },
      }),
    ]);

    const tenantById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
    const tenantAdminByTenantId = new Map<string, { id: string; email: string }>();
    for (const admin of tenantAdmins) {
      if (admin.tenantId && !tenantAdminByTenantId.has(admin.tenantId)) {
        tenantAdminByTenantId.set(admin.tenantId, { id: admin.id, email: admin.email });
      }
    }

    return orders.map((order) => {
      const tenant = tenantById.get(order.tenantId);
      const tenantAdmin = tenantAdminByTenantId.get(order.tenantId);
      const latestMirror = order.upstream_order_mirrors[0] ?? null;
      const latestJob = order.fulfillment_jobs[0] ?? null;
      const jobFailed = latestJob?.status === 'FAILED';
      const {
        user,
        resource,
        fulfillment_jobs: _fulfillmentJobs,
        upstream_order_mirrors: _upstreamOrderMirrors,
        ...baseOrder
      } = order;

      return {
        ...baseOrder,
        tenantCode: tenant?.code ?? null,
        tenantName: tenant?.name ?? null,
        tenantAdminId: tenantAdmin?.id ?? null,
        tenantAdminEmail: tenantAdmin?.email ?? null,
        userEmail: user?.email ?? null,
        providerCode: latestMirror?.providerCode ?? latestJob?.providerCode ?? resource?.providerCode ?? null,
        upstreamOrderId: latestMirror?.upstreamOrderId ?? null,
        failureStage: jobFailed ? latestJob.status : null,
        failureError: jobFailed ? latestJob.lastError ?? baseOrder.failReason ?? null : baseOrder.failReason ?? null,
        resource: resource
          ? {
              id: resource.id,
              code: resource.code,
              name: resource.name,
              displayName: resource.displayName,
              providerCode: resource.providerCode,
            }
          : null,
      };
    });
  }

  async getFulfillmentDetail(orderId: string, siteId: string): Promise<OrderFulfillmentDetail> {
    const [job, mirrors, proxies, operationLogs] = await Promise.all([
      prisma.fulfillment_jobs.findFirst({
        where: { orderId, siteId },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.upstream_order_mirrors.findMany({
        where: { orderId, siteId },
        orderBy: { createdAt: 'desc' },
        select: {
          providerCode: true,
          upstreamOrderId: true,
          status: true,
        },
      }),
      prisma.proxy_instances.findMany({
        where: { orderId, siteId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          ip: true,
          port: true,
          status: true,
          expiresAt: true,
        },
      }),
      prisma.audit_logs.findMany({
        where: {
          siteId,
          targetType: 'orders',
          targetId: orderId,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          action: true,
          actorType: true,
          actorId: true,
          reason: true,
          requestId: true,
          meta: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      taskStatus: job?.status ?? 'QUEUED',
      upstreamImage: mirrors.length > 0
        ? mirrors.map((m) => `${m.providerCode}:${m.upstreamOrderId}:${m.status}`).join(', ')
        : job?.providerCode ?? '',
      proxies,
      operationLogs,
    };
  }
}
