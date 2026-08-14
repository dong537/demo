import { assertSafeUrl } from '../../common/utils/ssrf';
import type { ProviderCode } from './provider.types';

const IPIPD_API_PREFIX = '/openapi/v2';
const NINE_EIGHT_FIVE_RESOURCE_PREFIX = '/res_static';
const PROXY_SELLER_API_PREFIX = '/personal/api/v1';

export function normalizeProviderBaseUrl(providerCode: ProviderCode, value: string): string {
  const trimmed = value.trim();
  assertSafeUrl(trimmed);

  const url = new URL(trimmed);
  if (providerCode === 'IPIPD' && url.hostname.toLowerCase() === 'sandbox.ipipd.cn') {
    url.hostname = 'api.sandbox.ipipd.cn';
  }
  url.hash = '';
  url.search = '';
  url.pathname = normalizeProviderBasePath(providerCode, url.hostname, url.pathname);
  return trimTrailingSlash(url.toString());
}

function normalizeProviderBasePath(providerCode: ProviderCode, hostname: string, pathname: string): string {
  const path = normalizePathname(pathname);
  if (providerCode === 'IPIPD') {
    return normalizeIpipdBasePath(hostname, path);
  }
  if (providerCode === 'NINE_EIGHT_FIVE') {
    return stripTrailingPath(path, NINE_EIGHT_FIVE_RESOURCE_PREFIX);
  }
  if (providerCode === 'PR') {
    const lower = path.toLowerCase();
    if (lower === PROXY_SELLER_API_PREFIX) return PROXY_SELLER_API_PREFIX;
    if (lower.startsWith(`${PROXY_SELLER_API_PREFIX}/`)) return PROXY_SELLER_API_PREFIX;
  }
  return path;
}

function normalizeIpipdBasePath(hostname: string, pathname: string): string {
  const lowerHost = hostname.toLowerCase();
  const lowerPath = pathname.toLowerCase();
  const canonicalHost = lowerHost === 'api.ipipd.cn' || lowerHost === 'api.sandbox.ipipd.cn';
  if (canonicalHost && (lowerPath === '/api' || lowerPath === `/api${IPIPD_API_PREFIX}`)) {
    return '';
  }
  return stripTrailingPath(pathname, IPIPD_API_PREFIX);
}

function stripTrailingPath(pathname: string, suffix: string): string {
  const lowerPath = pathname.toLowerCase();
  const lowerSuffix = suffix.toLowerCase();
  if (lowerPath === lowerSuffix) return '';
  if (!lowerPath.endsWith(lowerSuffix)) return pathname;
  return pathname.slice(0, -suffix.length).replace(/\/+$/, '');
}

function normalizePathname(pathname: string): string {
  const path = pathname.replace(/\/+$/, '');
  return path === '/' ? '' : path;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}
