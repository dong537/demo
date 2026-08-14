import { Controller, Get, Query } from '@nestjs/common';
import { RequireAuth } from '../../common/auth/guards';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { PageQueryDto, PageResult } from '../../common/pagination/pagination.dto';
import { UpstreamLogListItem } from '../providers/upstream-log.repository';
import { ListUpstreamLogsUseCase } from './list-upstream-logs.use-case';

@Controller('upstream-request-logs')
export class UpstreamRequestLogsController {
  constructor(private readonly listUseCase: ListUpstreamLogsUseCase) {}

  @Get()
  @RequireAuth()
  async list(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: PageQueryDto & { providerCode?: string; status?: string },
  ): Promise<PageResult<UpstreamLogListItem>> {
    return this.listUseCase.execute(ctx, query);
  }
}
