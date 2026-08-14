import { Module } from '@nestjs/common';
import { TicketsController } from './tickets.controller';
import { AdminTicketsController } from './admin-tickets.controller';
import { TicketsRepository } from './tickets.repository';
import { LoggerService } from '../../common/logging/logger.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { CreateTicketUseCase } from './use-cases/create-ticket.use-case';
import { ListTicketsUseCase } from './use-cases/list-tickets.use-case';
import { GetTicketUseCase } from './use-cases/get-ticket.use-case';
import { ReplyTicketUseCase } from './use-cases/reply-ticket.use-case';
import { CloseTicketUseCase } from './use-cases/close-ticket.use-case';
import { ListAdminTicketsUseCase } from './use-cases/list-admin-tickets.use-case';
import { GetAdminTicketUseCase } from './use-cases/get-admin-ticket.use-case';
import { ReplyAdminTicketUseCase } from './use-cases/reply-admin-ticket.use-case';
import { UpdateAdminTicketStatusUseCase } from './use-cases/update-admin-ticket-status.use-case';

@Module({
  imports: [NotificationsModule],
  controllers: [TicketsController, AdminTicketsController],
  providers: [
    TicketsRepository,
    LoggerService,
    CreateTicketUseCase,
    ListTicketsUseCase,
    GetTicketUseCase,
    ReplyTicketUseCase,
    CloseTicketUseCase,
    ListAdminTicketsUseCase,
    GetAdminTicketUseCase,
    ReplyAdminTicketUseCase,
    UpdateAdminTicketStatusUseCase,
  ],
})
export class TicketsModule {}
