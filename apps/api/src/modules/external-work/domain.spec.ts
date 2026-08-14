import { describe, expect, it } from 'vitest';
import { assertLeaseCompletion, isClaimableExternalWork } from './domain';

describe('external work lease domain', () => {
  const now = new Date('2026-08-11T00:00:00.000Z');

  it('claims queued work when the scheduled time has arrived', () => {
    expect(
      isClaimableExternalWork({
        status: 'QUEUED',
        nextRunAt: now,
        leaseExpiresAt: null,
      }, now),
    ).toBe(true);
  });

  it('does not steal unexpired work leased by another worker', () => {
    expect(
      isClaimableExternalWork({
        status: 'LEASED',
        nextRunAt: now,
        leaseExpiresAt: new Date('2026-08-11T00:00:01.000Z'),
      }, now),
    ).toBe(false);
  });

  it('allows retry work only after an expired lease and scheduled retry', () => {
    expect(
      isClaimableExternalWork({
        status: 'RETRYING',
        nextRunAt: new Date('2026-08-10T23:59:59.000Z'),
        leaseExpiresAt: new Date('2026-08-10T23:59:59.000Z'),
      }, now),
    ).toBe(true);
  });

  it('rejects completion by a worker without the current lease', () => {
    expect(() =>
      assertLeaseCompletion(
        { leaseOwner: 'worker-a', leaseExpiresAt: new Date('2026-08-11T00:05:00.000Z'), desiredVersion: 2 },
        { workerId: 'worker-b', desiredVersion: 2, now },
      ),
    ).toThrowError(expect.objectContaining({ reasonKey: 'external_work_lease_owner_mismatch' }));
  });

  it('rejects a completion after the lease expires or desired state changes', () => {
    expect(() =>
      assertLeaseCompletion(
        { leaseOwner: 'worker-a', leaseExpiresAt: new Date('2026-08-10T23:59:59.000Z'), desiredVersion: 2 },
        { workerId: 'worker-a', desiredVersion: 2, now },
      ),
    ).toThrowError(expect.objectContaining({ reasonKey: 'external_work_lease_expired' }));
    expect(() =>
      assertLeaseCompletion(
        { leaseOwner: 'worker-a', leaseExpiresAt: new Date('2026-08-11T00:05:00.000Z'), desiredVersion: 3 },
        { workerId: 'worker-a', desiredVersion: 2, now },
      ),
    ).toThrowError(expect.objectContaining({ reasonKey: 'external_work_desired_version_stale' }));
  });
});
