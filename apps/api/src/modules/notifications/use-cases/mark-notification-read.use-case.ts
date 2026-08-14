import { Injectable } from '@nestjs/common';
import { NotificationsRepository } from '../notifications.repository';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { requireNotificationOwner } from '../access';

@Injectable()
export class MarkNotificationReadUseCase {
  constructor(private readonly repo: NotificationsRepository) {}

  async execute(ctx: AuthenticatedContext, id: string): Promise<void> {
    const owner = requireNotificationOwner(ctx);
    await this.repo.markRead(id, owner);
  }
}
