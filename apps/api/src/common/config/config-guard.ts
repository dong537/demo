import { env } from './env.schema';
import { parseAllowlist } from './allowlist';

export class ConfigGuard {
  static verify(): void {
    if (env.NODE_ENV === 'production') {
      const required = ['DATABASE_URL', 'REDIS_URL', 'APP_ENCRYPTION_KEY', 'JWT_SECRET'] as const;
      for (const key of required) {
        if (!env[key]) {
          console.error(`[ConfigGuard] Missing required production env: ${key}`);
          process.exit(1);
          return;
        }
      }
      if (
        env.PROVIDER_FULFILLMENT_EXECUTION_ENABLED === 'true' &&
        parseAllowlist(env.PROVIDER_FULFILLMENT_PROVIDER_ALLOWLIST).size === 0 &&
        parseAllowlist(env.PROVIDER_FULFILLMENT_UPSTREAM_ACCOUNT_ALLOWLIST).size === 0
      ) {
        console.error('[ConfigGuard] Provider fulfillment execution requires at least one allowlist');
        process.exit(1);
        return;
      }
      if (!/^[0-9a-f]{40}$/i.test(env.RELEASE_GIT_SHA)) {
        console.error('[ConfigGuard] RELEASE_GIT_SHA must be a full Git commit SHA');
        process.exit(1);
      }
      if (
        env.DEDICATED_LINE_ORDER_EXECUTION_ENABLED === 'true' &&
        parseAllowlist(env.DEDICATED_LINE_ORDER_PROVIDER_ALLOWLIST).size === 0 &&
        parseAllowlist(env.DEDICATED_LINE_ORDER_ACCOUNT_ALLOWLIST).size === 0
      ) {
        console.error('[ConfigGuard] Dedicated-line order execution requires at least one allowlist');
        process.exit(1);
        return;
      }
      if (
        env.DEDICATED_LINE_ORDER_EXECUTION_ENABLED === 'true' &&
        (
          env.DEDICATED_LINE_PROJECTION_EXECUTION_ENABLED !== 'true' ||
          env.PROVIDER_INVENTORY_SYNC_ENABLED !== 'true' ||
          env.BARK_ALERTS_ENABLED !== 'true'
        )
      ) {
        console.error(
          '[ConfigGuard] Dedicated-line order execution requires projection execution, provider inventory sync, and Bark alerts',
        );
        process.exit(1);
        return;
      }
      if (env.BARK_ALERTS_ENABLED === 'true' && !env.BARK_DEVICE_KEYS.trim()) {
        console.error('[ConfigGuard] Bark alerts require at least one device key');
        process.exit(1);
        return;
      }
      if (
        env.DEDICATED_LINE_MIGRATION_EXECUTION_ENABLED === 'true'
        && env.DEDICATED_LINE_PROJECTION_EXECUTION_ENABLED !== 'true'
      ) {
        console.error('[ConfigGuard] Dedicated-line migration execution requires projection execution');
        process.exit(1);
        return;
      }
      if (
        env.DEDICATED_LINE_MIGRATION_EXECUTION_ENABLED === 'true'
        && !isHttpsNonLoopbackUrl(env.DEDICATED_LINE_MIGRATION_SMOKE_TARGET_URL)
      ) {
        console.error('[ConfigGuard] Dedicated-line migration execution requires an HTTPS non-loopback smoke runner');
        process.exit(1);
        return;
      }
      if (
        env.PROVIDER_INVENTORY_SYNC_ENABLED === 'true' &&
        env.WORKER_INVENTORY_SYNC_INTERVAL_MS >= env.DATABASE_INVENTORY_FRESHNESS_MS
      ) {
        console.error('[ConfigGuard] Inventory sync interval must be lower than inventory freshness TTL');
        process.exit(1);
        return;
      }
    }
  }
}

function isHttpsNonLoopbackUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:' && !isLoopbackUrl(value);
  } catch {
    return false;
  }
}

function isLoopbackUrl(value: string): boolean {
  const hostname = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname === '::1') return true;
  const ipv4 = hostname.split('.');
  if (isLoopbackIpv4(ipv4)) return true;
  const mapped = hostname.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!mapped) return false;
  const first = Number.parseInt(mapped[1], 16);
  const second = Number.parseInt(mapped[2], 16);
  return isLoopbackIpv4([
    String((first >> 8) & 0xff),
    String(first & 0xff),
    String((second >> 8) & 0xff),
    String(second & 0xff),
  ]);
}

function isLoopbackIpv4(ipv4: string[]): boolean {
  return ipv4.length === 4
    && ipv4.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
    && Number(ipv4[0]) === 127;
}
