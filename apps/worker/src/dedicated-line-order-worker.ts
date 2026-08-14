import type { DedicatedLineOrderExecutionResult } from '@ipeasy/api/worker';
import type { WorkerLogger } from './fulfillment-worker';

type RunnableJob = { id: string };

export interface DedicatedLineOrderQueue {
  findQueued(limit?: number): Promise<RunnableJob[]>;
  recoverExpiredLeases(): Promise<number>;
}

export interface DedicatedLineOrderExecutor {
  execute(jobId: string, workerId: string): Promise<DedicatedLineOrderExecutionResult>;
}

export interface DedicatedLineOrderWorkerOptions {
  executionEnabled: boolean;
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

export class DedicatedLineOrderWorker {
  private running = false;
  private disabledLogged = false;

  constructor(
    private readonly queue: DedicatedLineOrderQueue,
    private readonly executor: DedicatedLineOrderExecutor,
    private readonly options: DedicatedLineOrderWorkerOptions,
  ) {}

  async poll(): Promise<number> {
    if (this.running) return 0;
    if (!this.options.executionEnabled) {
      if (!this.disabledLogged) {
        this.logger.info('dedicated_line_order_worker_disabled');
        this.disabledLogged = true;
      }
      return 0;
    }

    this.running = true;
    try {
      const recovered = await this.queue.recoverExpiredLeases();
      if (recovered > 0) {
        this.logger.error('dedicated_line_order_ambiguous_leases_recovered', { count: recovered });
      }
      const jobs = await this.queue.findQueued(this.options.batchSize);
      const results = await Promise.allSettled(
        jobs.map((job) => this.executor.execute(job.id, this.options.workerId)),
      );
      results.forEach((result, index) => {
        const jobId = jobs[index]?.id ?? 'unknown';
        if (result.status === 'fulfilled') {
          this.logger.info('dedicated_line_order_job_result', result.value);
        } else {
          this.logger.error('dedicated_line_order_job_unhandled_error', {
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
