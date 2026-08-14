import { describe, expect, it, vi } from 'vitest';
import { DedicatedLineMigrationWorker } from './dedicated-line-migration-worker';

describe('DedicatedLineMigrationWorker', () => {
  it('does not scan or claim migration work while execution is disabled', async () => {
    const queue = { enqueueRunnableJobs: vi.fn(), recoverExpiredLeases: vi.fn(), findQueued: vi.fn() };
    const logger = { info: vi.fn(), error: vi.fn() };
    const worker = new DedicatedLineMigrationWorker(queue, { execute: vi.fn() }, {
      enabled: false, batchSize: 10, workerId: 'migration-worker', logger,
    });

    await expect(worker.poll()).resolves.toBe(0);
    expect(queue.enqueueRunnableJobs).not.toHaveBeenCalled();
    expect(queue.findQueued).not.toHaveBeenCalled();
  });

  it('materializes legal migration phases as external jobs before concurrent execution', async () => {
    const queue = {
      enqueueRunnableJobs: vi.fn().mockResolvedValue(3),
      recoverExpiredLeases: vi.fn().mockResolvedValue(1),
      findQueued: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]),
    };
    const executor = { execute: vi.fn().mockResolvedValue({ status: 'COMPLETED' }) };
    const worker = new DedicatedLineMigrationWorker(queue, executor, {
      enabled: true, batchSize: 10, workerId: 'migration-worker', logger: { info: vi.fn(), error: vi.fn() },
    });

    await expect(worker.poll()).resolves.toBe(2);
    expect(queue.enqueueRunnableJobs).toHaveBeenCalledWith(10);
    expect(queue.recoverExpiredLeases).toHaveBeenCalledOnce();
    expect(executor.execute).toHaveBeenCalledTimes(2);
  });

  it('does not run overlapping polls', async () => {
    let release!: () => void;
    const firstPoll = new Promise<number>((resolve) => { release = () => resolve(0); });
    const queue = {
      enqueueRunnableJobs: vi.fn().mockReturnValue(firstPoll),
      recoverExpiredLeases: vi.fn().mockResolvedValue(0),
      findQueued: vi.fn().mockResolvedValue([]),
    };
    const worker = new DedicatedLineMigrationWorker(queue, { execute: vi.fn() }, {
      enabled: true, batchSize: 10, workerId: 'migration-worker', logger: { info: vi.fn(), error: vi.fn() },
    });

    const first = worker.poll();
    await expect(worker.poll()).resolves.toBe(0);
    release();
    await expect(first).resolves.toBe(0);
    expect(queue.enqueueRunnableJobs).toHaveBeenCalledOnce();
  });
});
