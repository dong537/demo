import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { ManagedLineProjectionAdapter } from '../dedicated-line-projections/managed-line-projection.adapter';
import { DedicatedLineMigrationJobRepository } from './dedicated-line-migration-job.repository';
import { ProcessMigrationCleanupUseCase } from './process-migration-cleanup.use-case';
import { ProcessMigrationSmokeUseCase } from './process-migration-smoke.use-case';

export type DedicatedLineMigrationExecutionResult =
  | { status: 'NOOP' | 'COMPLETED' | 'WAITING'; jobId: string }
  | { status: 'RETRYING' | 'FAILED'; jobId: string; attempts: number }
  | { status: 'NEEDS_OPERATOR'; jobId: string; error: string };

@Injectable()
export class ProcessMigrationJobUseCase {
  constructor(
    private readonly jobs: DedicatedLineMigrationJobRepository,
    private readonly projectionAdapter: ManagedLineProjectionAdapter,
    private readonly smoke: ProcessMigrationSmokeUseCase,
    private readonly cleanup: ProcessMigrationCleanupUseCase,
  ) {}

  async execute(jobId: string, workerId = 'dedicated-line-migration-worker'): Promise<DedicatedLineMigrationExecutionResult> {
    const job = await this.jobs.claimRunnableJob(jobId, workerId);
    if (!job) return { status: 'NOOP', jobId };
    try {
      if (job.kind === 'DELETE_DEDICATED_LINE_PROJECTION') {
        const work = await this.jobs.loadProjectionDeleteWork(job, workerId);
        if (!work) return this.defer(job, workerId);
        await this.projectionAdapter.delete(
          { baseUrl: work.nodeBaseUrl, apiCredentialCiphertext: work.nodeApiCredentialCiphertext },
          work.projectionKey,
          work.desiredVersion,
        );
      } else if (job.kind === 'VERIFY_DEDICATED_LINE_MIGRATION') {
        const observation = await this.smoke.execute(job.aggregateId, smokeStage(job.payload));
        if (!observation.verified) {
          const reasonKey = observation.failureType ?? 'migration_smoke_failed';
          return this.fail(job, workerId, ErrorCode.UPSTREAM_ERROR, {
            reasonKey,
          }, isRetryableSmokeFailure(reasonKey));
        }
      } else if (job.kind === 'CLEANUP_DEDICATED_LINE_MIGRATION') {
        const result = await this.cleanup.execute(job.aggregateId);
        if (result.status === 'WAITING') return this.defer(job, workerId);
      } else {
        throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'migration_job_kind_invalid', 409);
      }
      await this.jobs.markCompleted(job, workerId);
      return { status: 'COMPLETED', jobId: job.id };
    } catch (error: unknown) {
      const code = error instanceof AppError ? error.code : ErrorCode.INTERNAL_ERROR;
      const reasonKey = error instanceof AppError ? error.reasonKey : 'dedicated_line_migration_processing_failed';
      return this.fail(job, workerId, String(code), { reasonKey }, code === ErrorCode.UPSTREAM_TIMEOUT || code === ErrorCode.UPSTREAM_ERROR);
    }
  }

  private async defer(job: Awaited<ReturnType<DedicatedLineMigrationJobRepository['claimRunnableJob']>> & {}, workerId: string): Promise<DedicatedLineMigrationExecutionResult> {
    await this.jobs.deferClaimed(job, workerId);
    return { status: 'WAITING', jobId: job.id };
  }

  private async fail(
    job: Awaited<ReturnType<DedicatedLineMigrationJobRepository['claimRunnableJob']>> & {},
    workerId: string,
    code: string,
    detail: Record<string, unknown>,
    retry: boolean,
  ): Promise<DedicatedLineMigrationExecutionResult> {
    const status = await this.jobs.markFailed(job, workerId, code, detail, { retry });
    if (status === 'NEEDS_OPERATOR') return { status, jobId: job.id, error: String(detail['reasonKey'] ?? code) };
    return { status, jobId: job.id, attempts: job.attempt };
  }
}

function isRetryableSmokeFailure(reasonKey: string): boolean {
  return reasonKey === 'TIMEOUT'
    || reasonKey === 'NETWORK_ERROR'
    || reasonKey === 'HTTP_408'
    || reasonKey === 'HTTP_429'
    || /^HTTP_5\d\d$/.test(reasonKey);
}

function smokeStage(payload: unknown): 'CANARY' | 'CUTOVER' | 'ROLLBACK' {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'migration_smoke_stage_invalid', 400);
  }
  const stage = (payload as Record<string, unknown>)['stage'];
  if (stage !== 'CANARY' && stage !== 'CUTOVER' && stage !== 'ROLLBACK') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'migration_smoke_stage_invalid', 400);
  }
  return stage;
}
