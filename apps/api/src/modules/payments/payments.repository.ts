import { Injectable } from '@nestjs/common';
import { prisma, Prisma, PaymentChannel, PaymentOrderStatus } from '@ipeasy/db';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PageQueryDto, PageResult, normalizePageQuery } from '../../common/pagination/pagination.dto';
import { paymentOrderUserSelect, type PaymentOrderWithUser } from './payment-order.mapper';

export type PaymentOrder = Prisma.payment_ordersGetPayload<Record<string, never>>;
type PrismaTransactionClient = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

@Injectable()
export class PaymentsRepository {
  async createPaymentOrder(data: {
    siteId: string;
    tenantId: string;
    userId: string;
    amount: string;
    currency: string;
    channel: PaymentChannel;
    idempotencyKey: string;
  }): Promise<PaymentOrder> {
    return prisma.payment_orders.create({ data: { ...data, status: 'PENDING' } });
  }

  async getPaymentOrderById(id: string, siteId: string, tenantId: string | null): Promise<PaymentOrderWithUser> {
    const where: Prisma.payment_ordersWhereInput = { id, siteId };
    // tenantId null/undefined means no tenant scoping (PLATFORM_ADMIN cross-tenant)
    if (tenantId) where.tenantId = tenantId;
    const order = await prisma.payment_orders.findFirst({
      where,
      include: { user: { select: paymentOrderUserSelect } },
    });
    if (!order) throw new AppError(ErrorCode.NOT_FOUND, 'payment_order_not_found', 404);
    return order;
  }

  async getPaymentOrderByIdempotencyKey(key: string, tenantId: string, userId: string): Promise<PaymentOrder | null> {
    const order = await prisma.payment_orders.findUnique({ where: { idempotencyKey: key } });
    if (!order) return null;
    if (order.tenantId !== tenantId || order.userId !== userId) {
      throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'payment_order_idempotency_conflict', 409);
    }
    return order;
  }

  async updatePaymentOrderStatus(
    tx: PrismaTransactionClient,
    id: string,
    status: PaymentOrderStatus,
    extra?: { confirmedBy?: string; confirmedAt?: Date; failReason?: string },
  ): Promise<PaymentOrder> {
    return tx.payment_orders.update({ where: { id }, data: { status, ...extra } });
  }

  async listPaymentOrders(
    siteId: string,
    tenantId: string | null,
    query: PageQueryDto & { userId?: string; status?: PaymentOrderStatus; channel?: PaymentChannel },
  ): Promise<PageResult<PaymentOrderWithUser>> {
    const { page, pageSize } = normalizePageQuery(query);
    const where: Prisma.payment_ordersWhereInput = { siteId };
    if (tenantId) where.tenantId = tenantId;
    if (query.userId) where.userId = query.userId;
    if (query.status) where.status = query.status;
    if (query.channel) where.channel = query.channel;

    const [total, items] = await Promise.all([
      prisma.payment_orders.count({ where }),
      prisma.payment_orders.findMany({
        where,
        include: { user: { select: paymentOrderUserSelect } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { page, pageSize, total, items };
  }
}
