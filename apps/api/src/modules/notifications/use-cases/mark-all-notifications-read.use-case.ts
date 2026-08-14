import { Injectable } from '@nestjs/common';
import { NotificationsRepository } from '../notifications.repository';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { requireNotificationOwner } from '../access';

@Injectable()
export class MarkAllNotificationsReadUseCase {
  constructor(private readonly repo: NotificationsRepository) {}

  async execute(ctx: AuthenticatedContext): Promise<void> {
    const owner = requireNotificationOwner(ctx);
    await this.repo.markAllRead(owner);
  }
}
