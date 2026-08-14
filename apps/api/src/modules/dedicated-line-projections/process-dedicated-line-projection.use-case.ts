import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { buildManagedLineProjectionRequest } from './build-managed-line-projection-request';
import { DedicatedLineProjectionRepository } from './dedicated-line-projection.repository';
import { managedLineProjectionDesiredHash } from './domain';
import { ManagedLineProjectionAdapter } from './managed-line-projection.adapter';

export type DedicatedLineProjectionExecutionResult =
  | { status: 'NOOP'; jobId: string }
  | { status: 'COMPLETED'; jobId: string; projectionId: string; observedVersion: number }
  | { status: 'RETRYING' | 'FAILED'; jobId: string; attempts: number }
  | { status: 'NEEDS_OPERATOR'; jobId: string; error: string };

@Injectable()
export class ProcessDedicatedLineProjectionUseCase {
  constructor(
    private readonly projections: DedicatedLineProjectionRepository,
    private readonly adapter: ManagedLineProjectionAdapter,
    private readonly config: ConfigService,
  ) {}

  async execute(jobId: string, workerId = 'dedicated-line-projection-worker'): Promise<DedicatedLineProjectionExecutionResult> {
    const job = await this.projections.claimRunnableJob(jobId, workerId);
    if (!job) return { status: 'NOOP', jobId };

    try {
      const work = await this.projections.loadClaimedWork(job, workerId);
      validateWork(work);
      const request = buildManagedLineProjectionRequest(work, this.config.get('APP_ENCRYPTION_KEY'));
      if (managedLineProjectionDesiredHash(request) !== work.desiredHash) {
        throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'managed_line_projection_desired_hash_mismatch', 409);
      }
      const observed = await this.adapter.upsert({
        baseUrl: work.nodeBaseUrl,
        apiCredentialCiphertext: work.nodeApiCredentialCiphertext,
      }, work.projectionKey, request);
      if (
        observed.projectionKey !== work.projectionKey
        || observed.desiredVersion !== work.desiredVersion
        || observed.observedVersion !== work.desiredVersion
        || observed.status !== 'ACTIVE'
        || !observed.observedHash
        || observed.desiredHash !== observed.observedHash
      ) {
        throw new AppError(ErrorCode.UPSTREAM_ERROR, 'managed_line_projection_readback_mismatch', 502);
      }
      await this.projections.markReady(job, workerId, {
        projectionId: work.projectionId,
        observedVersion: observed.observedVersion,
        observedHash: observed.observedHash,
        nodeExternalId: observed.projectionKey,
      });
      return { status: 'COMPLETED', jobId: job.id, projectionId: work.projectionId, observedVersion: observed.observedVersion };
    } catch (error: unknown) {
      const code = error instanceof AppError ? error.code : ErrorCode.INTERNAL_ERROR;
      const reasonKey = error instanceof AppError ? error.reasonKey : 'managed_line_projection_processing_failed';
      const retry = code === ErrorCode.UPSTREAM_TIMEOUT || code === ErrorCode.UPSTREAM_ERROR;
      const status = await this.projections.markFailed(job, workerId, String(code), { reasonKey }, { retry });
      if (status === 'NEEDS_OPERATOR') return { status, jobId: job.id, error: reasonKey };
      return { status, jobId: job.id, attempts: job.attempt };
    }
  }

}

function validateWork(work: Awaited<ReturnType<DedicatedLineProjectionRepository['loadClaimedWork']>>): void {
  if (work.nodeStatus === 'DISABLED') invalid('control_node_disabled');
  if (!work.inboundIsActive) invalid('dedicated_line_inbound_inactive');
  if (work.inboundControlNodeId && work.inboundControlNodeId !== work.nodeId) invalid('dedicated_line_inbound_node_mismatch');
  const expectedExitStatus = work.migrationId && work.migrationTargetExit ? 'RESERVED' : 'ASSIGNED';
  if (work.exitStatus !== expectedExitStatus) invalid(expectedExitStatus === 'RESERVED' ? 'dedicated_line_migration_exit_not_reserved' : 'dedicated_line_exit_not_assigned');
  if (work.exitExpiresAt && work.exitExpiresAt.getTime() <= Date.now()) invalid('dedicated_line_exit_expired');
  if (work.expiresAt && work.expiresAt.getTime() <= Date.now()) invalid('dedicated_line_expired');
}

function invalid(reasonKey: string): never {
  throw new AppError(ErrorCode.DEDICATED_LINE_CONFIG_INVALID, reasonKey, 500);
}
