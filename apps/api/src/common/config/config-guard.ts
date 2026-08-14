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
        }
      }
      if (
        env.PROVIDER_FULFILLMENT_EXECUTION_ENABLED === 'true' &&
        parseAllowlist(env.PROVIDER_FULFILLMENT_PROVIDER_ALLOWLIST).size === 0 &&
        parseAllowlist(env.PROVIDER_FULFILLMENT_UPSTREAM_ACCOUNT_ALLOWLIST).size === 0
      ) {
        console.error('[ConfigGuard] Provider fulfillment execution requires at least one allowlist');
        process.exit(1);
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
      }
      if (env.BARK_ALERTS_ENABLED === 'true' && !env.BARK_DEVICE_KEYS.trim()) {
        console.error('[ConfigGuard] Bark alerts require at least one device key');
        process.exit(1);
      }
      if (
        env.PROVIDER_INVENTORY_SYNC_ENABLED === 'true' &&
        env.WORKER_INVENTORY_SYNC_INTERVAL_MS >= env.DATABASE_INVENTORY_FRESHNESS_MS
      ) {
        console.error('[ConfigGuard] Inventory sync interval must be lower than inventory freshness TTL');
        process.exit(1);
      }
    }
  }
}
