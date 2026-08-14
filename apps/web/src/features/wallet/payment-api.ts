import { buildQuery } from '../../shared/api/client';

export interface PaymentOrderDto {
  id: string;
  userId: string;
  user?: {
    id: string;
    email: string;
    name: string | null;
    phone: string | null;
    status: string;
  } | null;
  amount: string;
  currency: string;
  channel: string;
  status: string;
  createdAt: string;
}

export interface PaymentOrderPageDto {
  page: number;
  pageSize: number;
  total: number;
  items: PaymentOrderDto[];
}

export interface PaymentOrderQuery {
  page: number;
  pageSize: number;
  status?: string;
  channel?: string;
}

export function buildPaymentOrdersPath(query: PaymentOrderQuery): string {
  return `/api/payments${buildQuery({
    page: query.page,
    pageSize: query.pageSize,
    status: query.status,
    channel: query.channel,
  })}`;
}
