import type { Prisma } from '@ipeasy/db/generated/client';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

type ProxyInstance = Prisma.proxy_instancesGetPayload<Record<string, never>>;
type Order = Prisma.ordersGetPayload<Record<string, never>>;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPACT_UUID_PATTERN = /^[0-9a-f]{32}$/i;

type PublicIdKind = 'order' | 'proxy' | 'resource';

const PUBLIC_ID_PREFIX: Record<PublicIdKind, string> = {
  order: 'ORD',
  proxy: 'IP',
  resource: 'RS',
};

export function mapProxy(p: ProxyInstance, password: string) {
  return {
    proxy_id: encodePublicId('proxy', p.id),
    order_no: encodePublicId('order', p.orderId),
    ip: p.ip,
    port: p.port,
    username: p.username,
    password,
    protocol: p.protocol,
    expire_time: p.expiresAt.toISOString(),
    country_code: p.countryCode,
  };
}

export function mapOrder(o: Order) {
  return {
    order_no: encodePublicId('order', o.id),
    status: o.status,
    create_time: o.createdAt.toISOString(),
    total_price: o.totalPrice.toString(),
    unit_price: o.unitPrice.toString(),
    duration_days: o.durationDays,
    quantity: o.quantity,
    currency: o.currency,
  };
}

type ResourceLike = {
  id: string;
  code: string;
  name: string;
  displayName: string | null;
  ipType: string;
  protocol: string;
  isSaleable: boolean;
};

export function mapResource(r: ResourceLike, stock?: number) {
  return {
    resource_id: encodePublicId('resource', r.id),
    area_code: r.code,
    area_name: r.displayName ?? r.name,
    ip_type: r.ipType,
    protocol: r.protocol,
    stock,
    is_saleable: r.isSaleable,
  };
}

export function encodePublicId(kind: PublicIdKind, uuid: string): string {
  if (!UUID_PATTERN.test(uuid)) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'invalid_internal_id', 500);
  }
  return `${PUBLIC_ID_PREFIX[kind]}_${uuid.replace(/-/g, '')}`;
}

export function decodePublicId(kind: PublicIdKind, value: string): string {
  const prefix = `${PUBLIC_ID_PREFIX[kind]}_`;
  if (!value.startsWith(prefix)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, `${kind}_id_invalid`, 400);
  }

  const compact = value.slice(prefix.length);
  if (!COMPACT_UUID_PATTERN.test(compact)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, `${kind}_id_invalid`, 400);
  }

  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20),
  ].join('-').toLowerCase();
}
