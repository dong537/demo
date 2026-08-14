import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { ProcessMigrationJobUseCase } from './process-migration-job.use-case';

describe('ProcessMigrationJobUseCase', () => {
  it('deletes a staged remote projection through a leased external job', async () => {
    const job = migrationJob('DELETE_DEDICATED_LINE_PROJECTION');
    const repository = {
      claimRunnableJob: vi.fn().mockResolvedValue(job),
      loadProjectionDeleteWork: vi.fn().mockResolvedValue({
        projectionId: 'projection-1', projectionKey: 'line-1:node-1:v2', desiredVersion: 2,
        nodeBaseUrl: 'https://panel.example.com', nodeApiCredentialCiphertext: 'ciphertext',
      }),
      markCompleted: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn(),
      deferClaimed: vi.fn(),
    };
    const adapter = { delete: vi.fn().mockResolvedValue(undefined) };
    const useCase = new ProcessMigrationJobUseCase(repository as never, adapter as never, { execute: vi.fn() } as never, { execute: vi.fn() } as never);

    await expect(useCase.execute(job.id, 'migration-worker')).resolves.toEqual({ status: 'COMPLETED', jobId: job.id });
    expect(adapter.delete).toHaveBeenCalledWith(
      { baseUrl: 'https://panel.example.com', apiCredentialCiphertext: 'ciphertext' },
      'line-1:node-1:v2',
      2,
    );
    expect(repository.markCompleted).toHaveBeenCalledWith(job, 'migration-worker');
  });

  it('retries a remote delete timeout and respects the repository max-attempt decision', async () => {
    const job = migrationJob('DELETE_DEDICATED_LINE_PROJECTION');
    const repository = {
      claimRunnableJob: vi.fn().mockResolvedValue(job),
      loadProjectionDeleteWork: vi.fn().mockResolvedValue({
        projectionId: 'projection-1', projectionKey: 'line-1:node-1:v2', desiredVersion: 2,
        nodeBaseUrl: 'https://panel.example.com', nodeApiCredentialCiphertext: 'ciphertext',
      }),
      markCompleted: vi.fn(),
      markFailed: vi.fn().mockResolvedValue('RETRYING'),
      deferClaimed: vi.fn(),
    };
    const adapter = { delete: vi.fn().mockRejectedValue(new AppError(ErrorCode.UPSTREAM_TIMEOUT, 'managed_line_timeout', 504)) };
    const useCase = new ProcessMigrationJobUseCase(repository as never, adapter as never, { execute: vi.fn() } as never, { execute: vi.fn() } as never);

    await expect(useCase.execute(job.id, 'migration-worker')).resolves.toEqual({ status: 'RETRYING', jobId: job.id, attempts: 1 });
    expect(repository.markFailed).toHaveBeenCalledWith(job, 'migration-worker', ErrorCode.UPSTREAM_TIMEOUT, { reasonKey: 'managed_line_timeout' }, { retry: true });
  });

  it('sends a non-retryable projection conflict to operator handling', async () => {
    const job = migrationJob('DELETE_DEDICATED_LINE_PROJECTION');
    const repository = {
      claimRunnableJob: vi.fn().mockResolvedValue(job),
      loadProjectionDeleteWork: vi.fn().mockResolvedValue({
        projectionId: 'projection-1', projectionKey: 'line-1:node-1:v2', desiredVersion: 2,
        nodeBaseUrl: 'https://panel.example.com', nodeApiCredentialCiphertext: 'ciphertext',
      }),
      markCompleted: vi.fn(),
      markFailed: vi.fn().mockResolvedValue('NEEDS_OPERATOR'),
      deferClaimed: vi.fn(),
    };
    const adapter = { delete: vi.fn().mockRejectedValue(new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'managed_line_projection_conflict', 409)) };
    const useCase = new ProcessMigrationJobUseCase(repository as never, adapter as never, { execute: vi.fn() } as never, { execute: vi.fn() } as never);

    await expect(useCase.execute(job.id, 'migration-worker')).resolves.toEqual({ status: 'NEEDS_OPERATOR', jobId: job.id, error: 'managed_line_projection_conflict' });
    expect(repository.markFailed).toHaveBeenCalledWith(job, 'migration-worker', ErrorCode.IDEMPOTENCY_CONFLICT, { reasonKey: 'managed_line_projection_conflict' }, { retry: false });
  });

  it('defers cleanup without consuming an error attempt while prerequisites are pending', async () => {
    const job = migrationJob('CLEANUP_DEDICATED_LINE_MIGRATION');
    const repository = {
      claimRunnableJob: vi.fn().mockResolvedValue(job),
      markCompleted: vi.fn(),
      markFailed: vi.fn(),
      deferClaimed: vi.fn().mockResolvedValue(undefined),
    };
    const cleanup = { execute: vi.fn().mockResolvedValue({ status: 'WAITING', migrationId: 'migration-1' }) };
    const useCase = new ProcessMigrationJobUseCase(repository as never, { delete: vi.fn() } as never, { execute: vi.fn() } as never, cleanup as never);

    await expect(useCase.execute(job.id, 'migration-worker')).resolves.toEqual({ status: 'WAITING', jobId: job.id });
    expect(repository.deferClaimed).toHaveBeenCalledWith(job, 'migration-worker');
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it('sends a deterministic smoke protocol failure to operator handling', async () => {
    const job = migrationJob('VERIFY_DEDICATED_LINE_MIGRATION');
    const repository = {
      claimRunnableJob: vi.fn().mockResolvedValue(job),
      markCompleted: vi.fn(),
      markFailed: vi.fn().mockResolvedValue('NEEDS_OPERATOR'),
      deferClaimed: vi.fn(),
    };
    const smoke = { execute: vi.fn().mockResolvedValue({ verified: false, failureType: 'TARGET_RESPONSE_INVALID' }) };
    const useCase = new ProcessMigrationJobUseCase(repository as never, { delete: vi.fn() } as never, smoke as never, { execute: vi.fn() } as never);

    await expect(useCase.execute(job.id, 'migration-worker')).resolves.toEqual({ status: 'NEEDS_OPERATOR', jobId: job.id, error: 'TARGET_RESPONSE_INVALID' });
    expect(repository.markFailed).toHaveBeenCalledWith(job, 'migration-worker', ErrorCode.UPSTREAM_ERROR, { reasonKey: 'TARGET_RESPONSE_INVALID' }, { retry: false });
  });
});

function migrationJob(kind: string) {
  return {
    id: 'job-1', kind, siteId: 'site-1', aggregateId: kind === 'DELETE_DEDICATED_LINE_PROJECTION' ? 'projection-1' : 'migration-1',
    aggregateType: kind === 'DELETE_DEDICATED_LINE_PROJECTION' ? 'dedicated_line_projection' : 'dedicated_line_migration',
    desiredVersion: 2, attempt: 1, maxAttempts: 5, leaseOwner: 'migration-worker',
    leaseExpiresAt: new Date(Date.now() + 60_000), payload: { migrationId: 'migration-1', stage: 'CANARY' },
  };
}
