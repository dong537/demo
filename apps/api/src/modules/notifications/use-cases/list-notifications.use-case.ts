import { Injectable } from '@nestjs/common';
import { NotificationsRepository, NotificationListQuery } from '../notifications.repository';
import { NotificationListItemDto } from '../dto';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { PageResult } from '../../../common/pagination/pagination.dto';
import { requireNotificationOwner } from '../access';
import { toNotificationListItem } from '../mappers';

@Injectable()
export class ListNotificationsUseCase {
  constructor(private readonly repo: NotificationsRepository) {}

  async execute(
    ctx: AuthenticatedContext,
    query: NotificationListQuery,
  ): Promise<PageResult<NotificationListItemDto>> {
    const owner = requireNotificationOwner(ctx);
    const result = await this.repo.listForOwner(owner, query);
    return { ...result, items: result.items.map(toNotificationListItem) };
  }
}
