import { Injectable } from '@nestjs/common';
import { NotificationsRepository } from '../notifications.repository';
import { UnreadCountDto } from '../dto';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { requireNotificationOwner } from '../access';

@Injectable()
export class GetUnreadCountUseCase {
  constructor(private readonly repo: NotificationsRepository) {}

  async execute(ctx: AuthenticatedContext): Promise<UnreadCountDto> {
    const owner = requireNotificationOwner(ctx);
    const count = await this.repo.countUnread(owner);
    return { count };
  }
}
