import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

export type ExternalWorkStatus = 'QUEUED' | 'LEASED' | 'RETRYING' | 'COMPLETED' | 'FAILED' | 'NEEDS_OPERATOR';

export interface ClaimableExternalWork {
  status: ExternalWorkStatus;
  nextRunAt: Date;
  leaseExpiresAt: Date | null;
}

export function isClaimableExternalWork(work: ClaimableExternalWork, now: Date): boolean {
  if (work.status !== 'QUEUED' && work.status !== 'RETRYING') return false;
  if (work.nextRunAt.getTime() > now.getTime()) return false;
  return work.leaseExpiresAt === null || work.leaseExpiresAt.getTime() <= now.getTime();
}

export function assertLeaseCompletion(
  work: { leaseOwner: string | null; leaseExpiresAt: Date | null; desiredVersion: number },
  input: { workerId: string; desiredVersion: number; now: Date },
): void {
  if (work.leaseOwner !== input.workerId) {
    throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'external_work_lease_owner_mismatch', 409);
  }
  if (work.leaseExpiresAt === null || work.leaseExpiresAt.getTime() <= input.now.getTime()) {
    throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'external_work_lease_expired', 409);
  }
  if (work.desiredVersion !== input.desiredVersion) {
    throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'external_work_desired_version_stale', 409);
  }
}
