import { describe, expect, it, vi } from 'vitest';
import { BarkOutboxWorker } from './bark-outbox-worker';

describe('BarkOutboxWorker', () => {
  it('processes available Bark alerts concurrently', async () => {
    let active = 0;
    let peak = 0;
    const worker = new BarkOutboxWorker(
      {
        recoverExpiredLeases: vi.fn().mockResolvedValue(0),
        findQueued: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
      },
      {
        execute: vi.fn(async (id: string) => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 10));
          active -= 1;
          return { status: 'PUBLISHED' as const, eventId: id };
        }),
      },
      { enabled: true, batchSize: 10, workerId: 'bark-worker', logger: silentLogger },
    );

    await expect(worker.poll()).resolves.toBe(3);
    expect(peak).toBe(3);
  });

  it('does not claim alerts while Bark delivery is disabled', async () => {
    const findQueued = vi.fn();
    const logger = { info: vi.fn(), error: vi.fn() };
    const worker = new BarkOutboxWorker(
      { recoverExpiredLeases: vi.fn(), findQueued },
      { execute: vi.fn() },
      { enabled: false, batchSize: 10, workerId: 'bark-worker', logger },
    );

    await expect(worker.poll()).resolves.toBe(0);
    await expect(worker.poll()).resolves.toBe(0);
    expect(findQueued).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('bark_outbox_worker_disabled');
    expect(logger.info).toHaveBeenCalledTimes(1);
  });
});

const silentLogger = { info: vi.fn(), error: vi.fn() };
