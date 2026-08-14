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
    const migration = await prisma.dedicated_line_migrations.findUnique({ where: { id: migrationId }, include: { dedicatedLine: { include: { domains: { where: { status: 'ACTIVE' } } } }, targetExit: true, nodes: true } });
    if (!migration) throw new AppError(ErrorCode.NOT_FOUND, 'migration_not_found', 404);
    const domain = migration.dedicatedLine.domains.find((item) => stage === 'CANARY' ? item.role === 'BACKUP' : item.role === 'PRIMARY');
    if (!domain) throw new AppError(ErrorCode.DEDICATED_LINE_CONFIG_INVALID, 'migration_smoke_domain_missing', 422);
    const result = await this.adapter.verify(domain.hostname, domain.port);
    return prisma.$transaction(async (tx) => {
      const observation = await tx.dedicated_line_smoke_observations.create({ data: { siteId: migration.siteId, tenantId: migration.tenantId, userId: migration.userId, dedicatedLineId: migration.dedicatedLineId, migrationId: migration.id, stage, hostname: domain.hostname, verified: result.verified, observedIp: result.observedIp, observedCountryCode: result.observedCountry, latencyMs: result.latencyMs, failureType: result.failureCode, failureDetail: result.detail as Prisma.InputJsonObject, freshUntil: new Date(Date.now() + 5 * 60_000) } });
      if (result.verified && stage !== 'ROLLBACK') {
        const next = assertMigrationTransition({ type: migration.type, phase: migration.phase, status: migration.status }, { type: 'SMOKE_VERIFIED' });
        await tx.dedicated_line_migrations.update({ where: { id: migration.id }, data: { phase: next.phase, status: next.status } });
      }
      return observation;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
