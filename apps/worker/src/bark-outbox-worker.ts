import type { BarkAlertExecutionResult } from '@ipeasy/api/worker';
import type { WorkerLogger } from './fulfillment-worker';

type RunnableEvent = { id: string };

export interface BarkOutboxQueue {
  findQueued(limit?: number): Promise<RunnableEvent[]>;
  recoverExpiredLeases(): Promise<number>;
}

export interface BarkOutboxExecutor {
  execute(eventId: string, workerId: string): Promise<BarkAlertExecutionResult>;
}

export interface BarkOutboxWorkerOptions {
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

export class BarkOutboxWorker {
  private running = false;
  private disabledLogged = false;

  constructor(
    private readonly queue: BarkOutboxQueue,
    private readonly executor: BarkOutboxExecutor,
    private readonly options: BarkOutboxWorkerOptions,
  ) {}

  async poll(): Promise<number> {
    if (this.running) return 0;
    if (!this.options.enabled) {
      if (!this.disabledLogged) {
        this.logger.info('bark_outbox_worker_disabled');
        this.disabledLogged = true;
      }
      return 0;
    }
    this.running = true;
    try {
      const recovered = await this.queue.recoverExpiredLeases();
      if (recovered > 0) this.logger.error('bark_outbox_ambiguous_leases_recovered', { count: recovered });
      const events = await this.queue.findQueued(this.options.batchSize);
      const results = await Promise.allSettled(events.map((event) => this.executor.execute(event.id, this.options.workerId)));
      results.forEach((result, index) => {
        const eventId = events[index]?.id ?? 'unknown';
        if (result.status === 'fulfilled') {
          this.logger.info('bark_outbox_event_result', result.value);
        } else {
          this.logger.error('bark_outbox_event_unhandled_error', {
            eventId,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
        }
      });
      return events.length;
    } finally {
      this.running = false;
    }
  }

  private get logger(): WorkerLogger {
    return this.options.logger ?? defaultLogger;
  }
}
