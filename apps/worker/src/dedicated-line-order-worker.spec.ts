import { describe, expect, it, vi } from 'vitest';
import { DedicatedLineOrderWorker } from './dedicated-line-order-worker';

describe('DedicatedLineOrderWorker', () => {
  it('processes a batch concurrently so ten orders do not serialize provider latency', async () => {
    let active = 0;
    let maxActive = 0;
    const release: Array<() => void> = [];
    const execute = vi.fn().mockImplementation(async (jobId: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => release.push(resolve));
      active -= 1;
      return { status: 'COMPLETED', jobId, reservationId: `r-${jobId}`, exits: 1 } as const;
    });
    const logger = { info: vi.fn(), error: vi.fn() };
    const worker = new DedicatedLineOrderWorker(
      {
        findQueued: vi.fn().mockResolvedValue([{ id: 'job-1' }, { id: 'job-2' }, { id: 'job-3' }]),
        recoverExpiredLeases: vi.fn().mockResolvedValue(0),
      },
      { execute },
      { executionEnabled: true, batchSize: 20, workerId: 'worker-1', logger },
    );

    const poll = worker.poll();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3));
    expect(maxActive).toBe(3);
    release.forEach((resolve) => resolve());

    await expect(poll).resolves.toBe(3);
    expect(execute).toHaveBeenCalledWith('job-1', 'worker-1');
  });

  it('never claims jobs when execution is disabled', async () => {
    const findQueued = vi.fn();
    const logger = { info: vi.fn(), error: vi.fn() };
    const worker = new DedicatedLineOrderWorker(
      { findQueued, recoverExpiredLeases: vi.fn() },
      { execute: vi.fn() },
      { executionEnabled: false, batchSize: 20, workerId: 'worker-1', logger },
    );

    await expect(worker.poll()).resolves.toBe(0);
    await expect(worker.poll()).resolves.toBe(0);
    expect(findQueued).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('dedicated_line_order_worker_disabled');
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('surfaces expired external-call leases as operator incidents', async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const worker = new DedicatedLineOrderWorker(
      {
        findQueued: vi.fn().mockResolvedValue([]),
        recoverExpiredLeases: vi.fn().mockResolvedValue(2),
      },
      { execute: vi.fn() },
      { executionEnabled: true, batchSize: 20, workerId: 'worker-1', logger },
    );

    await worker.poll();

    expect(logger.error).toHaveBeenCalledWith('dedicated_line_order_ambiguous_leases_recovered', { count: 2 });
  });
});
