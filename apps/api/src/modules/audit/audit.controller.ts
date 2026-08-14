import { Controller, Get, Query } from '@nestjs/common';
import { RequireAuth } from '../../common/auth/guards';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PageQueryDto, PageResult } from '../../common/pagination/pagination.dto';
import { AuditLogListItem, AuditRepository } from './audit.repository';

type AuditActorType = 'USER' | 'ADMIN_USER' | 'SYSTEM' | 'APIKEY';

@Controller('audit')
export class AuditController {
  constructor(private readonly repo: AuditRepository) {}

  @Get()
  @RequireAuth()
  async list(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: PageQueryDto & { action?: string; actorType?: AuditActorType },
  ): Promise<PageResult<AuditLogListItem>> {
    if (ctx.ownerType === 'PLATFORM_ADMIN') {
      return this.repo.listAuditLogs(ctx.siteId, null, query);
    }
    if (ctx.ownerType === 'TENANT_ADMIN') {
      return this.repo.listAuditLogs(ctx.siteId, ctx.tenantId, query);
    }
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
  }
}
