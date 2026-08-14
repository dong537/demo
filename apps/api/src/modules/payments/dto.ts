export interface PaymentOrderUserDto {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  status: string;
}

export interface PaymentOrderDto {
  id: string;
  userId: string;
  user?: PaymentOrderUserDto | null;
  amount: string;
  currency: string;
  channel: string;
  status: string;
  idempotencyKey: string;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  failReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePaymentOrderDto {
  amount: string;
  currency: string;
  channel: string;
  idempotencyKey: string;
}

export interface ConfirmPaymentOrderDto {
  reason?: string;
}
