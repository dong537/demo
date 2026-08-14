import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { Prisma } from '@ipeasy/db/generated/client';
import { MigrationSmokeAdapter } from './migration-smoke.adapter';
import { assertMigrationTransition } from './domain';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

@Injectable()
export class ProcessMigrationSmokeUseCase {
  constructor(private readonly adapter: MigrationSmokeAdapter) {}

  async execute(migrationId: string, stage: 'CANARY' | 'CUTOVER' | 'ROLLBACK') {
    const migration = await prisma.dedicated_line_migrations.findUnique({ where: { id: migrationId }, include: { dedicatedLine: { include: { domains: { where: { status: 'ACTIVE' } } } }, targetExit: true, nodes: true, smokeObservations: { where: { stage, verified: true, freshUntil: { gt: new Date() } }, orderBy: { observedAt: 'desc' }, take: 1 } } });
    if (!migration) throw new AppError(ErrorCode.NOT_FOUND, 'migration_not_found', 404);
    const existing = migration.smokeObservations[0];
    if (existing && existing.freshUntil.getTime() > Date.now()) return existing;
    if (migration.phase !== 'VERIFY' || migration.status !== 'ACTIVE') {
      throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'migration_phase_invalid', 409);
    }
    const domain = migration.dedicatedLine.domains.find((item) => stage === 'CANARY' ? item.role === 'BACKUP' : item.role === 'PRIMARY');
    if (!domain) throw new AppError(ErrorCode.DEDICATED_LINE_CONFIG_INVALID, 'migration_smoke_domain_missing', 422);
    let result: Awaited<ReturnType<MigrationSmokeAdapter['verify']>>;
    try {
      result = await this.adapter.verify(domain.hostname, domain.port);
    } catch (error: unknown) {
      if (!(error instanceof AppError)) throw error;
      result = {
        verified: false,
        observedIp: null,
        observedCountry: null,
        latencyMs: null,
        stabilitySamples: 0,
        failureCode: error.code === ErrorCode.UPSTREAM_TIMEOUT
          ? 'TIMEOUT'
          : error.reasonKey === 'dedicated_line_migration_smoke_network_error'
            ? 'NETWORK_ERROR'
            : error.code,
        detail: { reasonKey: error.reasonKey },
      };
    }
    if (result.verified && !sameCountry(result.observedCountry, migration.dedicatedLine.countryCode)) {
      result = {
        ...result,
        verified: false,
        failureCode: 'COUNTRY_MISMATCH',
        detail: {
          ...result.detail,
          expectedCountry: migration.dedicatedLine.countryCode,
          observedCountry: result.observedCountry,
        },
      };
    }
    return prisma.$transaction(async (tx) => {
      const observation = await tx.dedicated_line_smoke_observations.create({ data: { siteId: migration.siteId, tenantId: migration.tenantId, userId: migration.userId, dedicatedLineId: migration.dedicatedLineId, migrationId: migration.id, stage, hostname: domain.hostname, verified: result.verified, observedIp: result.observedIp, observedCountryCode: result.observedCountry, latencyMs: result.latencyMs, failureType: result.failureCode, failureDetail: result.detail as Prisma.InputJsonObject, freshUntil: new Date(Date.now() + 5 * 60_000) } });
      let transitionApplied = false;
      if (result.verified && stage !== 'ROLLBACK') {
        const next = assertMigrationTransition({ type: migration.type, phase: migration.phase, status: migration.status }, { type: 'SMOKE_VERIFIED' });
        const updated = await tx.dedicated_line_migrations.updateMany({
          where: { id: migration.id, phase: migration.phase, status: migration.status },
          data: { phase: next.phase, status: next.status },
        });
        transitionApplied = updated.count === 1;
      }
      await tx.audit_logs.create({
        data: {
          siteId: migration.siteId,
          tenantId: migration.tenantId,
          actorType: 'SYSTEM',
          actorId: 'dedicated-line-migration-worker',
          targetType: 'dedicated_line_migration',
          targetId: migration.id,
          action: 'dedicated_line.migration.smoke',
          requestId: `migration-smoke:${observation.id}`,
          meta: {
            stage,
            hostname: domain.hostname,
            verified: result.verified,
            observedCountryCode: result.observedCountry,
            failureType: result.failureCode,
            transitionApplied,
          },
        },
      });
      return observation;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

function sameCountry(observed: string | null, expected: string): boolean {
  return typeof observed === 'string'
    && observed.trim().length > 0
    && observed.trim().toUpperCase() === expected.trim().toUpperCase();
}
