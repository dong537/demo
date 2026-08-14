import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { RequireAuth } from '../../common/auth/guards';
import { CreateDedicatedLineMigrationUseCase } from './create-migration.use-case';
import { CommitDedicatedLineMigrationUseCase } from './commit-migration.use-case';
import { CancelDedicatedLineMigrationUseCase } from './cancel-migration.use-case';
import { ListDedicatedLineMigrationsUseCase } from './list-migrations.use-case';
import { RetryDedicatedLineMigrationUseCase } from './retry-migration.use-case';
import { ListDedicatedLineRecommendationsUseCase } from '../dedicated-line-health/list-recommendations.use-case';

@Controller('admin/control-plane/lines')
@RequireAuth()
export class DedicatedLineMigrationsController {
  constructor(private readonly createMigration: CreateDedicatedLineMigrationUseCase, private readonly commitMigration: CommitDedicatedLineMigrationUseCase, private readonly cancelMigration: CancelDedicatedLineMigrationUseCase, private readonly retryMigration: RetryDedicatedLineMigrationUseCase, private readonly listMigrations: ListDedicatedLineMigrationsUseCase, private readonly recommendations: ListDedicatedLineRecommendationsUseCase) {}

  @Get('recommendations')
  recommendationsList(@CurrentContext() ctx: AuthenticatedContext) {
    return this.recommendations.execute(ctx);
  }

  @Get(':id/migrations')
  list(@CurrentContext() ctx: AuthenticatedContext, @Param('id') lineId: string) {
    return this.listMigrations.list(ctx, lineId);
  }

  @Get(':id/migrations/:migrationId')
  get(@CurrentContext() ctx: AuthenticatedContext, @Param('migrationId') migrationId: string) {
    return this.listMigrations.get(ctx, migrationId);
  }

  @Post(':id/migrations')
  create(@CurrentContext() ctx: AuthenticatedContext, @Param('id') lineId: string, @Body() body: unknown) {
    return this.createMigration.execute(ctx, lineId, body);
  }

  @Post(':id/migrations/:migrationId/commit')
  commit(@CurrentContext() ctx: AuthenticatedContext, @Param('migrationId') migrationId: string) {
    return this.commitMigration.execute(ctx, migrationId);
  }

  @Post(':id/migrations/:migrationId/cancel')
  cancel(@CurrentContext() ctx: AuthenticatedContext, @Param('migrationId') migrationId: string) {
    return this.cancelMigration.execute(ctx, migrationId);
  }

  @Post(':id/migrations/:migrationId/retry')
  retry(@CurrentContext() ctx: AuthenticatedContext, @Param('migrationId') migrationId: string, @Body() body: unknown) {
    return this.retryMigration.execute(ctx, migrationId, body);
  }
}
