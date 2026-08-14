import { RequestMethod } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

export const RES_STATIC_ROUTE_PATHS = [
  'res_static/business',
  'res_static/inventory',
  'res_static/calculate',
  'res_static/buy',
  'res_static/renew',
  'res_static/order_result',
  'res_static/order_list',
  'res_static/ip_list',
  'res_static/ip_detail',
  'res_static/change_auth',
  'res_static/switch_ip_list',
  'res_static/switch_ip',
  'res_static/wallet/balance',
  'res_static/wallet/records',
];

export function configureGlobalPrefix(app: NestFastifyApplication): void {
  app.setGlobalPrefix('api', {
    exclude: [
      'health',
      'ready',
      ...RES_STATIC_ROUTE_PATHS.map((path) => ({ path, method: RequestMethod.POST })),
    ],
  });
}

export function isResStaticPath(value: string | undefined): boolean {
  if (!value) return false;
  const path = value.split('?', 1)[0] ?? '';
  return path === '/res_static' || path.startsWith('/res_static/');
}

export function isResStaticRequest(request: { url?: string; originalUrl?: string }): boolean {
  return isResStaticPath(request.url) || isResStaticPath(request.originalUrl);
}
