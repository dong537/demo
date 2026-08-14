import { describe, it, expect } from 'vitest';
import { AppError } from '../../common/errors/app-error';
import { formatProxyExport, parseProxyExportFormat, ProxyExportFormat } from './proxy-export';

const base = {
  ip: '1.2.3.4',
  port: 8080,
  username: 'user',
  password: 'pass',
};

describe('proxy export formatting', () => {
  it.each<[ProxyExportFormat, string]>([
    ['IP_PORT', '1.2.3.4:8080'],
    ['IP_PORT_AUTH', '1.2.3.4:8080:user:pass'],
    ['AUTH_AT_IP_PORT', 'user:pass@1.2.3.4:8080'],
    ['HTTP_URL', 'http://user:pass@1.2.3.4:8080'],
    ['SOCKS5_URL', 'socks5://user:pass@1.2.3.4:8080'],
  ])('formats %s', (format, expected) => {
    expect(formatProxyExport({ ...base, format })).toBe(expected);
  });

  it('defaults empty format to IP_PORT_AUTH', () => {
    expect(parseProxyExportFormat(undefined)).toBe('IP_PORT_AUTH');
    expect(parseProxyExportFormat('')).toBe('IP_PORT_AUTH');
  });

  it('rejects unsupported format values', () => {
    expect(() => parseProxyExportFormat('CSV')).toThrow(AppError);
  });
});
