import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { ListAdminTicketsUseCase } from './use-cases/list-admin-tickets.use-case';
import { GetAdminTicketUseCase } from './use-cases/get-admin-ticket.use-case';
import { ReplyAdminTicketUseCase } from './use-cases/reply-admin-ticket.use-case';
import { UpdateAdminTicketStatusUseCase } from './use-cases/update-admin-ticket-status.use-case';
import {
  AdminReplyTicketDto,
  AdminTicketDetailDto,
  AdminTicketListItemDto,
  UpdateTicketStatusDto,
} from './dto';
import { RequireAuth } from '../../common/auth/guards';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { PageQueryDto, PageResult } from '../../common/pagination/pagination.dto';

@Controller('admin/tickets')
export class AdminTicketsController {
  constructor(
    private readonly listUseCase: ListAdminTicketsUseCase,
    private readonly getUseCase: GetAdminTicketUseCase,
    private readonly replyUseCase: ReplyAdminTicketUseCase,
    private readonly statusUseCase: UpdateAdminTicketStatusUseCase,
  ) {}

  @Get()
  @RequireAuth()
  async list(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: PageQueryDto & { status?: string },
  ): Promise<PageResult<AdminTicketListItemDto>> {
    return this.listUseCase.execute(ctx, query);
  }

  @Get(':id')
  @RequireAuth()
  async getById(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
  ): Promise<AdminTicketDetailDto> {
    return this.getUseCase.execute(ctx, id);
  }

  @Post(':id/messages')
  @RequireAuth()
  async reply(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
    @Body() body: AdminReplyTicketDto,
  ): Promise<AdminTicketDetailDto> {
    return this.replyUseCase.execute(ctx, id, body);
  }

  @Post(':id/status')
  @RequireAuth()
  async updateStatus(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
    @Body() body: UpdateTicketStatusDto,
  ): Promise<AdminTicketDetailDto> {
    return this.statusUseCase.execute(ctx, id, body);
  }
}
