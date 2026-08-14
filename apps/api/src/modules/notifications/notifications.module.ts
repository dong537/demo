import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { ListNotificationsUseCase } from './use-cases/list-notifications.use-case';
import { GetUnreadCountUseCase } from './use-cases/get-unread-count.use-case';
import { MarkNotificationReadUseCase } from './use-cases/mark-notification-read.use-case';
import { MarkAllNotificationsReadUseCase } from './use-cases/mark-all-notifications-read.use-case';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsRepository,
    ListNotificationsUseCase,
    GetUnreadCountUseCase,
    MarkNotificationReadUseCase,
    MarkAllNotificationsReadUseCase,
  ],
  exports: [NotificationsRepository],
})
export class NotificationsModule {}
