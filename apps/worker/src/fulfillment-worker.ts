type RunnableJob = { id: string };
type FulfillmentExecutionResult =
  | { status: 'NOOP'; jobId: string }
  | { status: 'COMPLETED'; jobId: string; orderId: string }
  | { status: 'RETRYING'; jobId: string; orderId: string; attempts: number; error: string }
  | { status: 'FAILED_REFUNDED'; jobId: string; orderId: string; attempts: number; error: string };

export interface FulfillmentQueue {
  findQueued(limit?: number): Promise<RunnableJob[]>;
  recoverStaleRunningJobs?(timeoutMs?: number): Promise<number>;
}

export interface FulfillmentExecutor {
  execute(jobId: string): Promise<FulfillmentExecutionResult>;
}

export interface WorkerLogger {
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface FulfillmentWorkerOptions {
  executionEnabled: boolean;
  batchSize: number;
  logger?: WorkerLogger;
}

const defaultLogger: WorkerLogger = {
  info(message, context) {
    console.info(formatWorkerLog(message, context));
  },
  error(message, context) {
    console.error(formatWorkerLog(message, context));
  },
};

export class FulfillmentWorker {
  private running = false;
  private disabledLogged = false;

  constructor(
    private readonly queue: FulfillmentQueue,
    private readonly executor: FulfillmentExecutor,
    private readonly options: FulfillmentWorkerOptions,
  ) {}

  async poll(): Promise<number> {
    if (this.running) return 0;
    if (!this.options.executionEnabled) {
      if (!this.disabledLogged) {
        this.logger.info('fulfillment_worker_disabled');
        this.disabledLogged = true;
      }
      return 0;
    }

    this.running = true;
    try {
      const recovered = await this.queue.recoverStaleRunningJobs?.();
      if (recovered && recovered > 0) {
        this.logger.info('fulfillment_stale_running_jobs_recovered', { count: recovered });
      }
      const jobs = await this.queue.findQueued(this.options.batchSize);
      for (const job of jobs) {
        try {
          const result = await this.executor.execute(job.id);
          this.logger.info('fulfillment_job_result', result);
        } catch (err: unknown) {
          this.logger.error('fulfillment_job_unhandled_error', {
            jobId: job.id,
            ...errorContext(err),
          });
        }
      }
      return jobs.length;
    } finally {
      this.running = false;
    }
  }

  private get logger(): WorkerLogger {
    return this.options.logger ?? defaultLogger;
  }
}

function errorContext(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== 'object') return { error: String(err) };
  const record = err as Record<string, unknown>;
  return {
    error: err instanceof Error ? err.message : String(err),
    ...(typeof record['code'] === 'string' ? { code: record['code'] } : {}),
    ...(typeof record['reasonKey'] === 'string' ? { reasonKey: record['reasonKey'] } : {}),
    ...(typeof record['httpStatus'] === 'number' ? { httpStatus: record['httpStatus'] } : {}),
    ...(record['details'] !== undefined ? { details: record['details'] } : {}),
  };
}

function formatWorkerLog(message: string, context?: Record<string, unknown>): string {
  if (!context || Object.keys(context).length === 0) return message;
  return `${message} ${JSON.stringify(context)}`;
}
