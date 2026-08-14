import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@ipeasy/db';
import { FulfillmentRepository } from './fulfillment.repository';

vi.mock('@ipeasy/db', () => ({
  prisma: {
    fulfillment_jobs: {
      updateMany: vi.fn(),
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.fulfillment_jobs.updateMany).mockResolvedValue({ count: 1 });
});

describe('FulfillmentRepository', () => {
  it('recovers stale RUNNING jobs so interrupted worker jobs can be retried', async () => {
    const repo = new FulfillmentRepository();

    await expect(repo.recoverStaleRunningJobs(60_000)).resolves.toBe(1);

    const arg = vi.mocked(prisma.fulfillment_jobs.updateMany).mock.calls[0]?.[0];
    expect(arg).toMatchObject({
      where: {
        status: 'RUNNING',
        startedAt: { lte: expect.any(Date) },
      },
      data: {
        status: 'RETRYING',
        scheduledAt: expect.any(Date),
        lastError: 'worker_interrupted_recovered',
      },
    });
  });
});
