import { describe, expect, it } from 'vitest';
import { AppError } from '../../common/errors/app-error';
import { decodePublicId, encodePublicId, mapOrder, mapProxy, mapResource } from './res-static.mapper';

const uuid = '123e4567-e89b-42d3-a456-426614174000';

describe('res_static mapper', () => {
  it('encodes and decodes stable public ids', () => {
    const orderNo = encodePublicId('order', uuid);
    expect(orderNo).toBe('ORD_123e4567e89b42d3a456426614174000');
    expect(decodePublicId('order', orderNo)).toBe(uuid);
  });

  it('rejects raw UUIDs from public input', () => {
    expect(() => decodePublicId('order', uuid)).toThrow(AppError);
  });

  it('maps internal order and proxy ids to 985 fields without leaking UUIDs', () => {
    const order = mapOrder({
      id: uuid,
      status: 'COMPLETED',
      createdAt: new Date('2026-06-08T00:00:00.000Z'),
      totalPrice: { toString: () => '12.34000000' },
      unitPrice: { toString: () => '6.17000000' },
      durationDays: 30,
      quantity: 2,
      currency: 'CNY',
    } as never);

    const proxy = mapProxy({
      id: uuid,
      orderId: uuid,
      ip: '203.0.113.1',
      port: 8000,
      username: 'u',
      protocol: 'HTTP',
      expiresAt: new Date('2026-07-08T00:00:00.000Z'),
      countryCode: 'HK',
    } as never, 'p');

    expect(order.order_no).toMatch(/^ORD_/);
    expect(proxy.proxy_id).toMatch(/^IP_/);
    expect(proxy.order_no).toBe(order.order_no);
    expect(JSON.stringify({ order, proxy })).not.toContain(uuid);
  });

  it('maps resources to public resource ids and does not invent stock', () => {
    const resource = mapResource({
      id: uuid,
      code: 'HK',
      displayName: 'Hong Kong',
      name: 'HK',
      ipType: 'NATIVE',
      protocol: 'HTTP',
      isSaleable: true,
    } as never);

    expect(resource).toEqual({
      resource_id: 'RS_123e4567e89b42d3a456426614174000',
      area_code: 'HK',
      area_name: 'Hong Kong',
      ip_type: 'NATIVE',
      protocol: 'HTTP',
      stock: undefined,
      is_saleable: true,
    });
  });
});
