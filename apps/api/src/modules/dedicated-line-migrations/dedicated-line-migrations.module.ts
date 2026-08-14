import { Module } from '@nestjs/common';
import { CreateDedicatedLineMigrationUseCase } from './create-migration.use-case';
import { DedicatedLineMigrationsController } from './dedicated-line-migrations.controller';
import { MigrationSmokeAdapter } from './migration-smoke.adapter';
import { ProcessMigrationSmokeUseCase } from './process-migration-smoke.use-case';
import { CommitDedicatedLineMigrationUseCase } from './commit-migration.use-case';
import { CancelDedicatedLineMigrationUseCase } from './cancel-migration.use-case';
import { ProcessMigrationCleanupUseCase } from './process-migration-cleanup.use-case';
import { ListDedicatedLineMigrationsUseCase } from './list-migrations.use-case';
import { DedicatedLineHealthModule } from '../dedicated-line-health/dedicated-line-health.module';
import { ConfigService } from '../../common/config/config.service';
import { DedicatedLineProjectionsModule } from '../dedicated-line-projections/dedicated-line-projections.module';
import { DedicatedLineMigrationJobRepository } from './dedicated-line-migration-job.repository';
import { ProcessMigrationJobUseCase } from './process-migration-job.use-case';
import { RetryDedicatedLineMigrationUseCase } from './retry-migration.use-case';

@Module({ imports: [DedicatedLineHealthModule, DedicatedLineProjectionsModule], controllers: [DedicatedLineMigrationsController], providers: [ConfigService, { provide: 'MIGRATION_SMOKE_FETCH', useValue: fetch }, CreateDedicatedLineMigrationUseCase, MigrationSmokeAdapter, DedicatedLineMigrationJobRepository, ProcessMigrationJobUseCase, ProcessMigrationSmokeUseCase, CommitDedicatedLineMigrationUseCase, CancelDedicatedLineMigrationUseCase, RetryDedicatedLineMigrationUseCase, ProcessMigrationCleanupUseCase, ListDedicatedLineMigrationsUseCase], exports: [CreateDedicatedLineMigrationUseCase, DedicatedLineMigrationJobRepository, ProcessMigrationJobUseCase, ProcessMigrationSmokeUseCase, CommitDedicatedLineMigrationUseCase, CancelDedicatedLineMigrationUseCase, RetryDedicatedLineMigrationUseCase, ProcessMigrationCleanupUseCase, ListDedicatedLineMigrationsUseCase] })
export class DedicatedLineMigrationsModule {}
