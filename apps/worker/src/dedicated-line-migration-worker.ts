import type { DedicatedLineMigrationExecutionResult } from '@ipeasy/api/worker';
import type { WorkerLogger } from './fulfillment-worker';

type RunnableJob = { id: string };

export interface DedicatedLineMigrationQueue {
  enqueueRunnableJobs(limit?: number): Promise<number>;
  recoverExpiredLeases(): Promise<number>;
  findQueued(limit?: number): Promise<RunnableJob[]>;
}

export interface DedicatedLineMigrationExecutor {
  execute(jobId: string, workerId: string): Promise<DedicatedLineMigrationExecutionResult>;
}

export interface DedicatedLineMigrationWorkerOptions {
  enabled: boolean;
  batchSize: number;
  workerId: string;
  logger?: WorkerLogger;
}

const defaultLogger: WorkerLogger = {
  info(message, context) {
    console.info(context ? `${message} ${JSON.stringify(context)}` : message);
  },
  error(message, context) {
    console.error(context ? `${message} ${JSON.stringify(context)}` : message);
  },
};

export class DedicatedLineMigrationWorker {
  private running = false;
  private disabledLogged = false;

  constructor(
    private readonly queue: DedicatedLineMigrationQueue,
    private readonly executor: DedicatedLineMigrationExecutor,
    private readonly options: DedicatedLineMigrationWorkerOptions,
  ) {}

  async poll(): Promise<number> {
    if (this.running) return 0;
    if (!this.options.enabled) {
      if (!this.disabledLogged) {
        this.logger.info('dedicated_line_migration_worker_disabled');
        this.disabledLogged = true;
      }
      return 0;
    }
    this.running = true;
    try {
      const enqueued = await this.queue.enqueueRunnableJobs(this.options.batchSize);
      if (enqueued > 0) this.logger.info('dedicated_line_migration_jobs_enqueued', { count: enqueued });
      const recovered = await this.queue.recoverExpiredLeases();
      if (recovered > 0) this.logger.info('dedicated_line_migration_leases_recovered', { count: recovered });
      const jobs = await this.queue.findQueued(this.options.batchSize);
      const results = await Promise.allSettled(jobs.map((job) => this.executor.execute(job.id, this.options.workerId)));
      results.forEach((result, index) => {
        const jobId = jobs[index]?.id ?? 'unknown';
        if (result.status === 'fulfilled') {
          this.logger.info('dedicated_line_migration_job_result', result.value);
        } else {
          this.logger.error('dedicated_line_migration_job_unhandled_error', {
            jobId,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
        }
      });
      return jobs.length;
    } finally {
      this.running = false;
    }
  }

  private get logger(): WorkerLogger {
    return this.options.logger ?? defaultLogger;
  }
}
