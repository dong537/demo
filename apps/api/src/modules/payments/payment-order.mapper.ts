import { Prisma } from '@ipeasy/db';
import { PaymentOrderDto } from './dto';

export const paymentOrderUserSelect = {
  id: true,
  email: true,
  name: true,
  phone: true,
  status: true,
} satisfies Prisma.usersSelect;

export type PaymentOrderWithUser = Prisma.payment_ordersGetPayload<{
  include: { user: { select: typeof paymentOrderUserSelect } };
}>;

type PaymentOrderRecord = Prisma.payment_ordersGetPayload<Record<string, never>> | PaymentOrderWithUser;

export function toPaymentOrderDto(order: PaymentOrderRecord): PaymentOrderDto {
  const user = 'user' in order ? order.user : null;

  return {
    id: order.id,
    userId: order.userId,
    user: user
      ? {
          id: user.id,
          email: user.email,
          name: user.name,
          phone: user.phone,
          status: user.status,
        }
      : null,
    amount: order.amount.toString(),
    currency: order.currency,
    channel: order.channel,
    status: order.status,
    idempotencyKey: order.idempotencyKey,
    confirmedBy: order.confirmedBy,
    confirmedAt: order.confirmedAt,
    failReason: order.failReason,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}
