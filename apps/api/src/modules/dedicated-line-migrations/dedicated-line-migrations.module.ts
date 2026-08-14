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

@Module({ imports: [DedicatedLineHealthModule], controllers: [DedicatedLineMigrationsController], providers: [ConfigService, { provide: 'MIGRATION_SMOKE_FETCH', useValue: fetch }, CreateDedicatedLineMigrationUseCase, MigrationSmokeAdapter, ProcessMigrationSmokeUseCase, CommitDedicatedLineMigrationUseCase, CancelDedicatedLineMigrationUseCase, ProcessMigrationCleanupUseCase, ListDedicatedLineMigrationsUseCase], exports: [CreateDedicatedLineMigrationUseCase, ProcessMigrationSmokeUseCase, CommitDedicatedLineMigrationUseCase, CancelDedicatedLineMigrationUseCase, ProcessMigrationCleanupUseCase, ListDedicatedLineMigrationsUseCase] })
export class DedicatedLineMigrationsModule {}
