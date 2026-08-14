import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { ListNotificationsUseCase } from './use-cases/list-notifications.use-case';
import { GetUnreadCountUseCase } from './use-cases/get-unread-count.use-case';
import { MarkNotificationReadUseCase } from './use-cases/mark-notification-read.use-case';
import { MarkAllNotificationsReadUseCase } from './use-cases/mark-all-notifications-read.use-case';
import { NotificationListItemDto, UnreadCountDto } from './dto';
import { RequireAuth } from '../../common/auth/guards';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { PageQueryDto, PageResult } from '../../common/pagination/pagination.dto';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly listUseCase: ListNotificationsUseCase,
    private readonly unreadCountUseCase: GetUnreadCountUseCase,
    private readonly markReadUseCase: MarkNotificationReadUseCase,
    private readonly markAllReadUseCase: MarkAllNotificationsReadUseCase,
  ) {}

  @Get()
  @RequireAuth()
  async list(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: PageQueryDto & { unreadOnly?: string },
  ): Promise<PageResult<NotificationListItemDto>> {
    return this.listUseCase.execute(ctx, query);
  }

  @Get('unread-count')
  @RequireAuth()
  async unreadCount(@CurrentContext() ctx: AuthenticatedContext): Promise<UnreadCountDto> {
    return this.unreadCountUseCase.execute(ctx);
  }

  @Post('read-all')
  @RequireAuth()
  async readAll(@CurrentContext() ctx: AuthenticatedContext): Promise<void> {
    await this.markAllReadUseCase.execute(ctx);
  }

  @Post(':id/read')
  @RequireAuth()
  async markRead(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
  ): Promise<void> {
    await this.markReadUseCase.execute(ctx, id);
  }
}
