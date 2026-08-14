import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@ipeasy/db';
import { PaymentsRepository } from './payments.repository';
import { paymentOrderUserSelect } from './payment-order.mapper';

vi.mock('@ipeasy/db', () => ({
  prisma: {
    payment_orders: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
  },
  PaymentChannel: {},
  PaymentOrderStatus: {},
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PaymentsRepository', () => {
  it('loads payment orders with customer account information for admin lists', async () => {
    vi.mocked(prisma.payment_orders.count).mockResolvedValue(1);
    vi.mocked(prisma.payment_orders.findMany).mockResolvedValue([]);

    const repo = new PaymentsRepository();

    await repo.listPaymentOrders('site-1', 'tenant-1', {
      page: 2,
      pageSize: 10,
      status: 'PENDING',
      channel: 'MANUAL',
    });

    expect(prisma.payment_orders.count).toHaveBeenCalledWith({
      where: {
        siteId: 'site-1',
        tenantId: 'tenant-1',
        status: 'PENDING',
        channel: 'MANUAL',
      },
    });
    expect(prisma.payment_orders.findMany).toHaveBeenCalledWith({
      where: {
        siteId: 'site-1',
        tenantId: 'tenant-1',
        status: 'PENDING',
        channel: 'MANUAL',
      },
      include: { user: { select: paymentOrderUserSelect } },
      orderBy: { createdAt: 'desc' },
      skip: 10,
      take: 10,
    });
  });

  it('loads a payment detail with the same customer account projection', async () => {
    vi.mocked(prisma.payment_orders.findFirst).mockResolvedValue(paymentOrderWithUser() as never);

    const repo = new PaymentsRepository();
    const order = await repo.getPaymentOrderById('pay-1', 'site-1', 'tenant-1');

    expect(order.user.email).toBe('customer@example.com');
    expect(prisma.payment_orders.findFirst).toHaveBeenCalledWith({
      where: { id: 'pay-1', siteId: 'site-1', tenantId: 'tenant-1' },
      include: { user: { select: paymentOrderUserSelect } },
    });
  });
});

function paymentOrderWithUser() {
  return {
    id: 'pay-1',
    siteId: 'site-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    amount: { toString: () => '100.00' },
    currency: 'CNY',
    channel: 'MANUAL',
    status: 'PENDING',
    idempotencyKey: 'idem-1',
    channelOrderId: null,
    confirmedBy: null,
    confirmedAt: null,
    failReason: null,
    createdAt: new Date('2026-06-18T00:00:00.000Z'),
    updatedAt: new Date('2026-06-18T00:00:00.000Z'),
    meta: null,
    user: {
      id: 'user-1',
      email: 'customer@example.com',
      name: 'Alice',
      phone: '13800138000',
      status: 'ACTIVE',
    },
  };
}
