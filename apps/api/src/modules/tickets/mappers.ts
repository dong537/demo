import { Ticket, TicketWithMessages, TicketWithUser, TicketDetailWithUser } from './tickets.repository';
import {
  TicketDetailDto,
  TicketListItemDto,
  AdminTicketListItemDto,
  AdminTicketDetailDto,
} from './dto';

export function toTicketListItem(ticket: Ticket): TicketListItemDto {
  return {
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

export function toTicketDetail(ticket: TicketWithMessages): TicketDetailDto {
  return {
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    messages: ticket.messages.map((m) => ({
      id: m.id,
      authorType: m.authorType,
      authorId: m.authorId,
      body: m.body,
      createdAt: m.createdAt,
    })),
  };
}

export function toAdminTicketListItem(ticket: TicketWithUser): AdminTicketListItemDto {
  return {
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    userId: ticket.userId,
    userEmail: ticket.user.email,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

export function toAdminTicketDetail(ticket: TicketDetailWithUser): AdminTicketDetailDto {
  return {
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    userId: ticket.userId,
    userEmail: ticket.user.email,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    messages: ticket.messages.map((m) => ({
      id: m.id,
      authorType: m.authorType,
      authorId: m.authorId,
      body: m.body,
      createdAt: m.createdAt,
    })),
  };
}
