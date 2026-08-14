import { PROXY_SELLER_MIN_INVENTORY_FRESHNESS_TTL_SECONDS } from './domain';

const DEFAULT_DATABASE_INVENTORY_FRESHNESS_MS = 3_600_000;

export function inventoryFreshnessTtlSeconds(providerCode?: string | null): number {
  const ttlMs = Number(process.env['DATABASE_INVENTORY_FRESHNESS_MS'] ?? DEFAULT_DATABASE_INVENTORY_FRESHNESS_MS);
  const baseTtlSeconds = Number.isFinite(ttlMs) && ttlMs >= 60_000
    ? Math.floor(ttlMs / 1000)
    : Math.floor(DEFAULT_DATABASE_INVENTORY_FRESHNESS_MS / 1000);
  return providerCode === 'PR'
    ? Math.max(baseTtlSeconds, PROXY_SELLER_MIN_INVENTORY_FRESHNESS_TTL_SECONDS)
    : baseTtlSeconds;
}
