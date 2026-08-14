import { describe, expect, it, vi } from 'vitest';
import { InventorySyncWorker } from './inventory-sync-worker';
import type { ProviderAccountSyncRecord } from '@ipeasy/api/worker';

function account(overrides: Partial<ProviderAccountSyncRecord> = {}): ProviderAccountSyncRecord {
  return {
    id: 'account-1',
    siteId: 'site-1',
    tenantId: null,
    providerCode: 'IPIPD',
    status: 'ACTIVE',
    inventorySyncEnabled: true,
    enabledCountryCodes: [],
    ...overrides,
  };
}

function syncResult(overrides: Partial<{
  attempted: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  synced: number;
  syncedAt: Date;
  upstreamRawStatus: 'SUCCESS';
  countries: string[];
}> = {}) {
  return {
    attempted: 1,
    created: 1,
    updated: 0,
    skipped: 0,
    failed: 0,
    synced: 1,
    syncedAt: new Date('2026-06-11T00:00:00.000Z'),
    upstreamRawStatus: 'SUCCESS' as const,
    countries: ['GB'],
    ...overrides,
  };
}

describe('InventorySyncWorker', () => {
  it('does not scan provider accounts when inventory sync is disabled', async () => {
    const listInventorySyncEnabled = vi.fn().mockResolvedValue([account()]);
    const execute = vi.fn().mockResolvedValue(syncResult());
    const logger = { info: vi.fn(), error: vi.fn() };
    const worker = new InventorySyncWorker(
      { listInventorySyncEnabled },
      { execute },
      { enabled: false, logger },
    );

    await expect(worker.poll()).resolves.toBe(0);
    await expect(worker.poll()).resolves.toBe(0);
    expect(listInventorySyncEnabled).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('inventory_sync_worker_disabled');
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('syncs each active inventory-enabled provider account by account id', async () => {
    const listInventorySyncEnabled = vi.fn().mockResolvedValue([
      account({ id: 'pa-ipipd', providerCode: 'IPIPD' }),
      account({ id: 'pa-985', providerCode: 'NINE_EIGHT_FIVE', tenantId: 'tenant-1' }),
    ]);
    const execute = vi.fn().mockResolvedValue(syncResult({ attempted: 3, created: 2, updated: 1, synced: 3, countries: ['GB', 'HK'] }));
    const logger = { info: vi.fn(), error: vi.fn() };
    const worker = new InventorySyncWorker(
      { listInventorySyncEnabled },
      { execute },
      { enabled: true, logger },
    );

    await expect(worker.poll()).resolves.toBe(2);
    expect(execute).toHaveBeenNthCalledWith(1, 'site-1', 'IPIPD', null, 'pa-ipipd');
    expect(execute).toHaveBeenNthCalledWith(2, 'site-1', 'NINE_EIGHT_FIVE', 'tenant-1', 'pa-985');
    expect(logger.info).toHaveBeenCalledWith('inventory_sync_account_success', expect.objectContaining({
      accountId: 'pa-ipipd',
      attempted: 3,
      created: 2,
      updated: 1,
      synced: 3,
      failed: 0,
      countries: ['GB', 'HK'],
    }));
  });

  it('logs an account sync failure and continues with the next account', async () => {
    const listInventorySyncEnabled = vi.fn().mockResolvedValue([
      account({ id: 'pa-fail', providerCode: 'PR' }),
      account({ id: 'pa-ok', providerCode: 'IPIPD' }),
    ]);
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('upstream failed'))
      .mockResolvedValueOnce(syncResult({ attempted: 2, synced: 2 }));
    const logger = { info: vi.fn(), error: vi.fn() };
    const worker = new InventorySyncWorker(
      { listInventorySyncEnabled },
      { execute },
      { enabled: true, logger },
    );

    await expect(worker.poll()).resolves.toBe(1);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith('inventory_sync_account_failed', expect.objectContaining({
      accountId: 'pa-fail',
      providerCode: 'PR',
      error: 'upstream failed',
    }));
  });

  it('logs structured AppError fields for account sync failures', async () => {
    const listInventorySyncEnabled = vi.fn().mockResolvedValue([
      account({ id: 'pa-fail', providerCode: 'PR' }),
    ]);
    const error = Object.assign(new Error('inventory_empty'), {
      code: 'UPSTREAM_ERROR',
      reasonKey: 'inventory_empty',
      httpStatus: 502,
      details: { upstreamStatus: 'empty' },
    });
    const execute = vi.fn().mockRejectedValue(error);
    const logger = { info: vi.fn(), error: vi.fn() };
    const worker = new InventorySyncWorker(
      { listInventorySyncEnabled },
      { execute },
      { enabled: true, logger },
    );

    await expect(worker.poll()).resolves.toBe(0);
    expect(logger.error).toHaveBeenCalledWith('inventory_sync_account_failed', expect.objectContaining({
      accountId: 'pa-fail',
      providerCode: 'PR',
      error: 'inventory_empty',
      code: 'UPSTREAM_ERROR',
      reasonKey: 'inventory_empty',
      httpStatus: 502,
      details: { upstreamStatus: 'empty' },
    }));
  });

  it('does not run overlapping polls', async () => {
    let release!: () => void;
    const firstPoll = new Promise<ProviderAccountSyncRecord[]>((resolve) => {
      release = () => resolve([account()]);
    });
    const listInventorySyncEnabled = vi.fn().mockReturnValue(firstPoll);
    const execute = vi.fn().mockResolvedValue(syncResult());
    const worker = new InventorySyncWorker(
      { listInventorySyncEnabled },
      { execute },
      { enabled: true, logger: { info: vi.fn(), error: vi.fn() } },
    );

    const first = worker.poll();
    await expect(worker.poll()).resolves.toBe(0);
    release();
    await expect(first).resolves.toBe(1);

    expect(listInventorySyncEnabled).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });
});
