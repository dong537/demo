import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { PageResult } from '../../common/pagination/pagination.dto';
import {
  ListUpstreamLogsQuery,
  UpstreamLogListItem,
  UpstreamLogRepository,
} from '../providers/upstream-log.repository';

@Injectable()
export class ListUpstreamLogsUseCase {
  constructor(private readonly repo: UpstreamLogRepository) {}

  async execute(
    ctx: AuthenticatedContext,
    query: ListUpstreamLogsQuery,
  ): Promise<PageResult<UpstreamLogListItem>> {
    if (ctx.ownerType !== 'PLATFORM_ADMIN') {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
    }

    return this.repo.listForSite(ctx.siteId, query);
  }
}
