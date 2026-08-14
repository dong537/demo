import { describe, expect, it, vi } from 'vitest';
import { DedicatedLineProjectionWorker } from './dedicated-line-projection-worker';

describe('DedicatedLineProjectionWorker', () => {
  it('reconciles all runnable projection jobs', async () => {
    const executor = { execute: vi.fn().mockResolvedValue({ status: 'COMPLETED' }) };
    const worker = new DedicatedLineProjectionWorker(
      { recoverExpiredLeases: vi.fn().mockResolvedValue(1), findQueued: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]) },
      executor as never,
      { enabled: true, batchSize: 10, workerId: 'projection-worker', logger: silentLogger },
    );

    await expect(worker.poll()).resolves.toBe(2);
    expect(executor.execute).toHaveBeenCalledTimes(2);
  });

  it('does not claim jobs while projection execution is disabled', async () => {
    const queue = { recoverExpiredLeases: vi.fn(), findQueued: vi.fn() };
    const logger = { info: vi.fn(), error: vi.fn() };
    const worker = new DedicatedLineProjectionWorker(
      queue,
      { execute: vi.fn() },
      { enabled: false, batchSize: 10, workerId: 'projection-worker', logger },
    );

    await expect(worker.poll()).resolves.toBe(0);
    await expect(worker.poll()).resolves.toBe(0);
    expect(queue.findQueued).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('dedicated_line_projection_worker_disabled');
    expect(logger.info).toHaveBeenCalledTimes(1);
  });
});

const silentLogger = { info: vi.fn(), error: vi.fn() };
