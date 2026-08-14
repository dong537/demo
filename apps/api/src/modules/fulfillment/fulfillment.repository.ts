import { Injectable } from '@nestjs/common';
import { prisma, Prisma, FulfillmentJobStatus } from '@ipeasy/db';

export type FulfillmentJob = Prisma.fulfillment_jobsGetPayload<Record<string, never>>;
type PrismaTransactionClient = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;
const DEFAULT_RUNNING_TIMEOUT_MS = 10 * 60 * 1000;

@Injectable()
export class FulfillmentRepository {
  async createJob(tx: PrismaTransactionClient, data: Prisma.fulfillment_jobsCreateInput): Promise<FulfillmentJob> {
    return tx.fulfillment_jobs.create({ data });
  }

  async findQueued(limit = 20): Promise<FulfillmentJob[]> {
    return prisma.fulfillment_jobs.findMany({
      where: { status: { in: ['QUEUED', 'RETRYING'] }, scheduledAt: { lte: new Date() } },
      orderBy: { scheduledAt: 'asc' },
      take: limit,
    });
  }

  async claimRunnableJob(id: string): Promise<FulfillmentJob | null> {
    const result = await prisma.fulfillment_jobs.updateMany({
      where: { id, status: { in: ['QUEUED', 'RETRYING'] }, scheduledAt: { lte: new Date() } },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    if (result.count === 0) return null;
    return prisma.fulfillment_jobs.findUnique({ where: { id } });
  }

  async recoverStaleRunningJobs(timeoutMs = DEFAULT_RUNNING_TIMEOUT_MS): Promise<number> {
    const staleBefore = new Date(Date.now() - timeoutMs);
    const result = await prisma.fulfillment_jobs.updateMany({
      where: {
        status: 'RUNNING',
        startedAt: { lte: staleBefore },
      },
      data: {
        status: 'RETRYING',
        scheduledAt: new Date(),
        lastError: 'worker_interrupted_recovered',
      },
    });
    return result.count;
  }

  async updateJobStatus(
    id: string,
    status: FulfillmentJobStatus,
    extra?: Partial<Pick<FulfillmentJob, 'scheduledAt' | 'startedAt' | 'completedAt' | 'lastError' | 'attempts'>>,
  ): Promise<FulfillmentJob> {
    return prisma.fulfillment_jobs.update({ where: { id }, data: { status, ...extra } });
  }
}
