import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { CreateTicketUseCase } from './use-cases/create-ticket.use-case';
import { ListTicketsUseCase } from './use-cases/list-tickets.use-case';
import { GetTicketUseCase } from './use-cases/get-ticket.use-case';
import { ReplyTicketUseCase } from './use-cases/reply-ticket.use-case';
import { CloseTicketUseCase } from './use-cases/close-ticket.use-case';
import { CreateTicketDto, ReplyTicketDto, TicketDetailDto, TicketListItemDto } from './dto';
import { RequireAuth } from '../../common/auth/guards';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { PageQueryDto, PageResult } from '../../common/pagination/pagination.dto';

@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly createUseCase: CreateTicketUseCase,
    private readonly listUseCase: ListTicketsUseCase,
    private readonly getUseCase: GetTicketUseCase,
    private readonly replyUseCase: ReplyTicketUseCase,
    private readonly closeUseCase: CloseTicketUseCase,
  ) {}

  @Get()
  @RequireAuth()
  async list(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: PageQueryDto,
  ): Promise<PageResult<TicketListItemDto>> {
    return this.listUseCase.execute(ctx, query);
  }

  @Post()
  @RequireAuth()
  async create(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: CreateTicketDto,
  ): Promise<TicketDetailDto> {
    return this.createUseCase.execute(ctx, body);
  }

  @Get(':id')
  @RequireAuth()
  async getById(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
  ): Promise<TicketDetailDto> {
    return this.getUseCase.execute(ctx, id);
  }

  @Post(':id/messages')
  @RequireAuth()
  async reply(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
    @Body() body: ReplyTicketDto,
  ): Promise<TicketDetailDto> {
    return this.replyUseCase.execute(ctx, id, body);
  }

  @Post(':id/close')
  @RequireAuth()
  async close(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
  ): Promise<TicketDetailDto> {
    return this.closeUseCase.execute(ctx, id);
  }
}
