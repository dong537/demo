import { beforeEach, describe, it, expect, vi } from 'vitest';
import { FulfillmentWorker } from './fulfillment-worker';

describe('FulfillmentWorker', () => {
  const completedResult = { status: 'COMPLETED' as const, jobId: 'job-1', orderId: 'order-1' };
  const options = {
    executionEnabled: true,
    batchSize: 2,
    logger: { info: vi.fn(), error: vi.fn() },
  };

  beforeEach(() => {
    options.logger.info.mockClear();
    options.logger.error.mockClear();
  });

  it('does not scan jobs when fulfillment execution is disabled', async () => {
    const findQueued = vi.fn().mockResolvedValue([{ id: 'job-1' }]);
    const execute = vi.fn().mockResolvedValue(completedResult);
    const logger = { info: vi.fn(), error: vi.fn() };

    const worker = new FulfillmentWorker(
      { findQueued } as never,
      { execute } as never,
      { ...options, executionEnabled: false, logger },
    );

    await expect(worker.poll()).resolves.toBe(0);
    await expect(worker.poll()).resolves.toBe(0);
    expect(findQueued).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('fulfillment_worker_disabled');
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('polls queued jobs and delegates fulfillment by id', async () => {
    const findQueued = vi.fn().mockResolvedValue([{ id: 'job-1' }, { id: 'job-2' }]);
    const execute = vi.fn()
      .mockResolvedValueOnce(completedResult)
      .mockResolvedValueOnce({ status: 'RETRYING', jobId: 'job-2', orderId: 'order-2', attempts: 1, error: 'upstream_pending' });

    const worker = new FulfillmentWorker({ findQueued } as never, { execute } as never, options);
    await expect(worker.poll()).resolves.toBe(2);

    expect(findQueued).toHaveBeenCalledWith(2);
    expect(execute).toHaveBeenNthCalledWith(1, 'job-1');
    expect(execute).toHaveBeenNthCalledWith(2, 'job-2');
    expect(options.logger.info).toHaveBeenCalledWith('fulfillment_job_result', completedResult);
    expect(options.logger.info).toHaveBeenCalledWith('fulfillment_job_result', expect.objectContaining({
      status: 'RETRYING',
      jobId: 'job-2',
    }));
  });

  it('recovers stale running jobs before polling queued jobs', async () => {
    const findQueued = vi.fn().mockResolvedValue([{ id: 'job-1' }]);
    const recoverStaleRunningJobs = vi.fn().mockResolvedValue(2);
    const execute = vi.fn().mockResolvedValue(completedResult);
    const logger = { info: vi.fn(), error: vi.fn() };

    const worker = new FulfillmentWorker(
      { findQueued, recoverStaleRunningJobs },
      { execute },
      { ...options, logger },
    );

    await expect(worker.poll()).resolves.toBe(1);

    expect(recoverStaleRunningJobs).toHaveBeenCalledOnce();
    expect(findQueued).toHaveBeenCalledWith(2);
    expect(logger.info).toHaveBeenCalledWith('fulfillment_stale_running_jobs_recovered', { count: 2 });
    expect(execute).toHaveBeenCalledWith('job-1');
  });

  it('does not run overlapping polls', async () => {
    let release!: () => void;
    const firstPoll = new Promise<{ id: string }[]>((resolve) => {
      release = () => resolve([{ id: 'job-1' }]);
    });
    const findQueued = vi.fn().mockReturnValue(firstPoll);
    const execute = vi.fn().mockResolvedValue(completedResult);

    const worker = new FulfillmentWorker({ findQueued } as never, { execute } as never, options);
    const first = worker.poll();
    await expect(worker.poll()).resolves.toBe(0);
    release();
    await expect(first).resolves.toBe(1);

    expect(findQueued).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });

  it('logs a failed job and continues with the next job', async () => {
    const findQueued = vi.fn().mockResolvedValue([{ id: 'job-1' }, { id: 'job-2' }]);
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('upstream failed'))
      .mockResolvedValueOnce({ status: 'FAILED_REFUNDED', jobId: 'job-2', orderId: 'order-2', attempts: 3, error: 'provider_disabled' });
    const logger = { info: vi.fn(), error: vi.fn() };

    const worker = new FulfillmentWorker(
      { findQueued } as never,
      { execute } as never,
      { ...options, logger },
    );

    await expect(worker.poll()).resolves.toBe(2);
    expect(execute).toHaveBeenNthCalledWith(1, 'job-1');
    expect(execute).toHaveBeenNthCalledWith(2, 'job-2');
    expect(logger.error).toHaveBeenCalledWith('fulfillment_job_unhandled_error', {
      jobId: 'job-1',
      error: 'upstream failed',
    });
    expect(logger.info).toHaveBeenCalledWith('fulfillment_job_result', expect.objectContaining({
      status: 'FAILED_REFUNDED',
      jobId: 'job-2',
    }));
  });

  it('logs structured AppError fields for unhandled fulfillment errors', async () => {
    const findQueued = vi.fn().mockResolvedValue([{ id: 'job-1' }]);
    const error = Object.assign(new Error('provider_disabled'), {
      code: 'UPSTREAM_DISABLED',
      reasonKey: 'provider_disabled',
      httpStatus: 503,
      details: { providerCode: 'PR' },
    });
    const execute = vi.fn().mockRejectedValue(error);
    const logger = { info: vi.fn(), error: vi.fn() };

    const worker = new FulfillmentWorker(
      { findQueued } as never,
      { execute } as never,
      { ...options, logger },
    );

    await expect(worker.poll()).resolves.toBe(1);
    expect(logger.error).toHaveBeenCalledWith('fulfillment_job_unhandled_error', {
      jobId: 'job-1',
      error: 'provider_disabled',
      code: 'UPSTREAM_DISABLED',
      reasonKey: 'provider_disabled',
      httpStatus: 503,
      details: { providerCode: 'PR' },
    });
  });
});
