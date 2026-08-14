export interface InventoryFreshnessInput {
  capturedAt: Date;
  freshnessTtlSeconds: number;
  isStale: boolean;
  providerCode?: string | null;
}

export const PROXY_SELLER_MIN_INVENTORY_FRESHNESS_TTL_SECONDS = 6 * 60 * 60;

export function isInventorySnapshotStale(
  snapshot: InventoryFreshnessInput,
  now: Date = new Date(),
): boolean {
  const expiresAt = snapshot.capturedAt.getTime() + effectiveInventoryFreshnessTtlSeconds(snapshot) * 1000;
  return snapshot.isStale || expiresAt < now.getTime();
}

export function hasBuyableInventory(_providerCode: string, stock: number | null): boolean {
  return stock !== null && stock > 0;
}

export function effectiveInventoryFreshnessTtlSeconds(snapshot: InventoryFreshnessInput): number {
  if (snapshot.providerCode === 'PR') {
    return Math.max(snapshot.freshnessTtlSeconds, PROXY_SELLER_MIN_INVENTORY_FRESHNESS_TTL_SECONDS);
  }
  return snapshot.freshnessTtlSeconds;
}
