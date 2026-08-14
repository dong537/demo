import { describe, expect, it, vi } from 'vitest';
import { encryptAesGcm } from '../../common/crypto/aes-gcm';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { ProcessDedicatedLineProjectionUseCase } from './process-dedicated-line-projection.use-case';
import { managedLineProjectionDesiredHash } from './domain';
import type { ManagedLineProjectionRequest } from './managed-line-projection.adapter';

const encryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('ProcessDedicatedLineProjectionUseCase', () => {
  it('decrypts the owned line and exit data, applies it, and records observed state', async () => {
    const job = projectionJob();
    const work = projectionWork();
    const repository = {
      claimRunnableJob: vi.fn().mockResolvedValue(job),
      loadClaimedWork: vi.fn().mockResolvedValue(work),
      markReady: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn(),
    };
    const adapter = {
      upsert: vi.fn().mockResolvedValue({
        projectionKey: work.projectionKey,
        desiredVersion: 3,
        observedVersion: 3,
        desiredHash: 'openui-hash',
        observedHash: 'openui-hash',
        status: 'ACTIVE',
      }),
    };
    const useCase = new ProcessDedicatedLineProjectionUseCase(
      repository as never,
      adapter as never,
      { get: () => encryptionKey } as never,
    );

    await expect(useCase.execute(job.id, 'projection-worker')).resolves.toEqual({
      status: 'COMPLETED',
      jobId: job.id,
      projectionId: work.projectionId,
      observedVersion: 3,
    });
    expect(adapter.upsert).toHaveBeenCalledWith(
      { baseUrl: 'https://panel.example.com', apiCredentialCiphertext: 'node-credential' },
      work.projectionKey,
      expectedRequest(),
    );
    expect(repository.markReady).toHaveBeenCalledWith(job, 'projection-worker', {
      projectionId: work.projectionId,
      observedVersion: 3,
      observedHash: 'openui-hash',
      nodeExternalId: work.projectionKey,
    });
  });

  it('retries an idempotent projection after a control-node timeout', async () => {
    const job = projectionJob();
    const repository = {
      claimRunnableJob: vi.fn().mockResolvedValue(job),
      loadClaimedWork: vi.fn().mockResolvedValue(projectionWork()),
      markReady: vi.fn(),
      markFailed: vi.fn().mockResolvedValue('RETRYING'),
    };
    const adapter = { upsert: vi.fn().mockRejectedValue(new AppError(ErrorCode.UPSTREAM_TIMEOUT, 'managed_line_timeout', 504)) };
    const useCase = new ProcessDedicatedLineProjectionUseCase(repository as never, adapter as never, { get: () => encryptionKey } as never);

    await expect(useCase.execute(job.id, 'projection-worker')).resolves.toEqual({
      status: 'RETRYING', jobId: job.id, attempts: 1,
    });
    expect(repository.markFailed).toHaveBeenCalledWith(
      job,
      'projection-worker',
      ErrorCode.UPSTREAM_TIMEOUT,
      { reasonKey: 'managed_line_timeout' },
      { retry: true },
    );
  });

  it('projects a suspended line with the runtime client disabled', async () => {
    const job = projectionJob();
    const work = {
      ...projectionWork(),
      lineStatus: 'SUSPENDED' as const,
      desiredHash: managedLineProjectionDesiredHash(expectedRequest(false)),
    };
    const repository = {
      claimRunnableJob: vi.fn().mockResolvedValue(job),
      loadClaimedWork: vi.fn().mockResolvedValue(work),
      markReady: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn(),
    };
    const adapter = {
      upsert: vi.fn().mockResolvedValue({
        projectionKey: work.projectionKey,
        desiredVersion: 3,
        observedVersion: 3,
        desiredHash: 'openui-hash',
        observedHash: 'openui-hash',
        status: 'ACTIVE',
      }),
    };
    const useCase = new ProcessDedicatedLineProjectionUseCase(
      repository as never,
      adapter as never,
      { get: () => encryptionKey } as never,
    );

    await expect(useCase.execute(job.id, 'projection-worker')).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(adapter.upsert).toHaveBeenCalledWith(
      { baseUrl: 'https://panel.example.com', apiCredentialCiphertext: 'node-credential' },
      work.projectionKey,
      expectedRequest(false),
    );
  });

  it('accepts a NODE_ONLY migration projection with the current assigned exit', async () => {
    const job = projectionJob();
    const work = { ...projectionWork(), migrationId: 'migration-1', migrationTargetExit: false };
    const repository = {
      claimRunnableJob: vi.fn().mockResolvedValue(job),
      loadClaimedWork: vi.fn().mockResolvedValue(work),
      markReady: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn(),
    };
    const adapter = {
      upsert: vi.fn().mockResolvedValue({
        projectionKey: work.projectionKey,
        desiredVersion: 3,
        observedVersion: 3,
        desiredHash: 'openui-hash',
        observedHash: 'openui-hash',
        status: 'ACTIVE',
      }),
    };
    const useCase = new ProcessDedicatedLineProjectionUseCase(
      repository as never,
      adapter as never,
      { get: () => encryptionKey } as never,
    );

    await expect(useCase.execute(job.id, 'projection-worker')).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it('requires operator action when OpenUI reports a version conflict', async () => {
    const job = projectionJob();
    const repository = {
      claimRunnableJob: vi.fn().mockResolvedValue(job),
      loadClaimedWork: vi.fn().mockResolvedValue(projectionWork()),
      markReady: vi.fn(),
      markFailed: vi.fn().mockResolvedValue('NEEDS_OPERATOR'),
    };
    const adapter = { upsert: vi.fn().mockRejectedValue(new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'managed_line_projection_conflict', 409)) };
    const useCase = new ProcessDedicatedLineProjectionUseCase(repository as never, adapter as never, { get: () => encryptionKey } as never);

    await expect(useCase.execute(job.id, 'projection-worker')).resolves.toEqual({
      status: 'NEEDS_OPERATOR', jobId: job.id, error: 'managed_line_projection_conflict',
    });
    expect(repository.markFailed).toHaveBeenCalledWith(
      job,
      'projection-worker',
      ErrorCode.IDEMPOTENCY_CONFLICT,
      { reasonKey: 'managed_line_projection_conflict' },
      { retry: false },
    );
  });
});

function projectionJob() {
  return {
    id: 'job-1', siteId: 'site-1', tenantId: 'tenant-1', userId: 'user-1', dedicatedLineId: 'line-1',
    desiredVersion: 3, attempt: 1, maxAttempts: 5, leaseOwner: 'projection-worker',
    leaseExpiresAt: new Date(Date.now() + 60_000),
  };
}

function projectionWork() {
  return {
    projectionId: 'projection-1', projectionKey: 'line-1-node-1', desiredVersion: 3,
    desiredHash: managedLineProjectionDesiredHash(expectedRequest()),
    nodeId: 'node-1', nodeStatus: 'ACTIVE' as const, nodeBaseUrl: 'https://panel.example.com',
    nodeApiCredentialCiphertext: 'node-credential', inboundTag: 'sv-hk-1', inboundIsActive: true,
    inboundControlNodeId: null, lineStatus: 'PROVISIONING' as const, protocol: 'VLESS' as const,
    clientEmail: 'line-1@365proxy.internal',
    clientIdentityCiphertext: encryptAesGcm(JSON.stringify({ id: 'b4c689a8-76cf-4f4c-a2bf-2668502488a1' }), encryptionKey),
    expiresAt: new Date(1_900_000_000_000), quotaBytes: 50_000n,
    uplinkLimitBps: 0n, downlinkLimitBps: 0n, maxConnections: 0, ipLimit: 2,
    exitStatus: 'ASSIGNED' as const, migrationId: null, migrationTargetExit: false, exitCountryCode: 'US', exitExpiresAt: new Date(1_900_000_000_000),
    endpointCiphertext: encryptAesGcm(JSON.stringify({ host: '203.0.113.9', port: 1080, protocol: 'SOCKS5' }), encryptionKey),
    credentialCiphertext: encryptAesGcm(JSON.stringify({ username: 'exit-user', password: 'exit-password' }), encryptionKey),
  };
}

function expectedRequest(enabled = true): ManagedLineProjectionRequest {
  return {
    desiredVersion: 3,
    inboundTag: 'sv-hk-1',
    protocol: 'VLESS',
    client: { email: 'line-1@365proxy.internal', id: 'b4c689a8-76cf-4f4c-a2bf-2668502488a1' },
    egress: { host: '203.0.113.9', port: 1080, username: 'exit-user', password: 'exit-password' },
    lifecycle: {
      enabled,
      expiresAtMs: 1_900_000_000_000,
      trafficLimitBytes: 50_000,
      ipLimit: 2,
      uplinkLimitBps: 0,
      downlinkLimitBps: 0,
      maxConnections: 0,
    },
  };
}
