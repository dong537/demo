import { describe, expect, it } from 'vitest';
import { hasBuyableInventory, isInventorySnapshotStale } from '../domain';

describe('resources domain', () => {
  it('marks inventory stale when the explicit stale flag is set', () => {
    const now = new Date('2026-06-08T00:00:00.000Z');

    expect(
      isInventorySnapshotStale(
        {
          capturedAt: now,
          freshnessTtlSeconds: 300,
          isStale: true,
        },
        now,
      ),
    ).toBe(true);
  });

  it('marks inventory stale when capturedAt plus ttl is before now', () => {
    expect(
      isInventorySnapshotStale(
        {
          capturedAt: new Date('2026-06-08T00:00:00.000Z'),
          freshnessTtlSeconds: 300,
          isStale: false,
        },
        new Date('2026-06-08T00:06:00.000Z'),
      ),
    ).toBe(true);
  });

  it('keeps inventory fresh inside ttl when stale flag is false', () => {
    expect(
      isInventorySnapshotStale(
        {
          capturedAt: new Date('2026-06-08T00:00:00.000Z'),
          freshnessTtlSeconds: 300,
          isStale: false,
        },
        new Date('2026-06-08T00:04:59.000Z'),
      ),
    ).toBe(false);
  });

  it('keeps Proxy-Seller snapshots fresh beyond legacy 300 second rows', () => {
    expect(
      isInventorySnapshotStale(
        {
          providerCode: 'PR',
          capturedAt: new Date('2026-06-08T00:00:00.000Z'),
          freshnessTtlSeconds: 300,
          isStale: false,
        },
        new Date('2026-06-08T01:00:00.000Z'),
      ),
    ).toBe(false);
  });

  it('requires positive inventory for every provider before quote/order can proceed', () => {
    expect(hasBuyableInventory('PR', 0)).toBe(false);
    expect(hasBuyableInventory('PR', null)).toBe(false);
    expect(hasBuyableInventory('IPIPD', 0)).toBe(false);
    expect(hasBuyableInventory('NINE_EIGHT_FIVE', 1)).toBe(true);
  });
});
