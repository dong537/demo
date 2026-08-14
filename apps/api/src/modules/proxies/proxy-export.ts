import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

export type ProxyExportFormat = 'IP_PORT' | 'IP_PORT_AUTH' | 'AUTH_AT_IP_PORT' | 'HTTP_URL' | 'SOCKS5_URL';

const FORMATS = new Set<ProxyExportFormat>([
  'IP_PORT',
  'IP_PORT_AUTH',
  'AUTH_AT_IP_PORT',
  'HTTP_URL',
  'SOCKS5_URL',
]);

export function parseProxyExportFormat(value: unknown): ProxyExportFormat {
  if (typeof value === 'undefined' || value === null || value === '') return 'IP_PORT_AUTH';
  if (typeof value !== 'string' || !FORMATS.has(value as ProxyExportFormat)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'proxy_export_format_invalid', 400);
  }
  return value as ProxyExportFormat;
}

export function formatProxyExport(input: {
  ip: string;
  port: number;
  username: string;
  password: string;
  format: ProxyExportFormat;
}): string {
  switch (input.format) {
    case 'IP_PORT':
      return `${input.ip}:${input.port}`;
    case 'IP_PORT_AUTH':
      return `${input.ip}:${input.port}:${input.username}:${input.password}`;
    case 'AUTH_AT_IP_PORT':
      return `${input.username}:${input.password}@${input.ip}:${input.port}`;
    case 'HTTP_URL':
      return `http://${input.username}:${input.password}@${input.ip}:${input.port}`;
    case 'SOCKS5_URL':
      return `socks5://${input.username}:${input.password}@${input.ip}:${input.port}`;
  }
}
