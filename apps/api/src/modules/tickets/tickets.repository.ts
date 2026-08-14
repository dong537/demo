import { Injectable } from '@nestjs/common';
import { prisma, Prisma } from '@ipeasy/db';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PageQueryDto, PageResult, normalizePageQuery } from '../../common/pagination/pagination.dto';

export type Ticket = Prisma.ticketsGetPayload<Record<string, never>>;
export type TicketMessage = Prisma.ticket_messagesGetPayload<Record<string, never>>;
export type TicketWithMessages = Prisma.ticketsGetPayload<{ include: { messages: true } }>;
export type TicketWithUser = Prisma.ticketsGetPayload<{ include: { user: { select: { id: true; email: true } } } }>;
export type TicketDetailWithUser = Prisma.ticketsGetPayload<{
  include: { messages: true; user: { select: { id: true; email: true } } };
}>;

interface OwnerScope {
  ownerId: string;
  siteId: string;
  tenantId: string;
}

/**
 * Admin-side scope: `tenantId === null` means the whole site (PLATFORM_ADMIN);
 * a concrete value narrows to that tenant (TENANT_ADMIN). Never filters by
 * ownerId, so admins can read tickets they do not own — but only within scope.
 */
interface AdminScope {
  siteId: string;
  tenantId: string | null;
}

export interface AdminTicketListQuery extends PageQueryDto {
  status?: string;
}

@Injectable()
export class TicketsRepository {
  async createWithFirstMessage(data: {
    siteId: string;
    tenantId: string;
    userId: string;
    subject: string;
    body: string;
  }): Promise<TicketWithMessages> {
    return prisma.$transaction(async (tx) => {
      const ticket = await tx.tickets.create({
        data: {
          siteId: data.siteId,
          tenantId: data.tenantId,
          userId: data.userId,
          subject: data.subject,
          status: 'OPEN',
        },
      });
      await tx.ticket_messages.create({
        data: {
          ticketId: ticket.id,
          siteId: data.siteId,
          tenantId: data.tenantId,
          authorType: 'USER',
          authorId: data.userId,
          body: data.body,
        },
      });
      return tx.tickets.findUniqueOrThrow({
        where: { id: ticket.id },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
    });
  }

  async listForOwner(owner: OwnerScope, query: PageQueryDto): Promise<PageResult<Ticket>> {
    const { page, pageSize } = normalizePageQuery(query);
    const where: Prisma.ticketsWhereInput = {
      userId: owner.ownerId,
      siteId: owner.siteId,
      tenantId: owner.tenantId,
    };

    const [total, items] = await Promise.all([
      prisma.tickets.count({ where }),
      prisma.tickets.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { page, pageSize, total, items };
  }

  /**
   * Loads a ticket scoped to its owner. A ticket that exists but belongs to
   * another owner is reported as NOT_FOUND so existence is not leaked.
   */
  async getOwnedWithMessages(id: string, owner: OwnerScope): Promise<TicketWithMessages> {
    const ticket = await prisma.tickets.findFirst({
      where: {
        id,
        userId: owner.ownerId,
        siteId: owner.siteId,
        tenantId: owner.tenantId,
      },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!ticket) throw new AppError(ErrorCode.NOT_FOUND, 'ticket_not_found', 404);
    return ticket;
  }

  async getOwned(id: string, owner: OwnerScope): Promise<Ticket> {
    const ticket = await prisma.tickets.findFirst({
      where: {
        id,
        userId: owner.ownerId,
        siteId: owner.siteId,
        tenantId: owner.tenantId,
      },
    });
    if (!ticket) throw new AppError(ErrorCode.NOT_FOUND, 'ticket_not_found', 404);
    return ticket;
  }

  async appendUserMessage(data: {
    ticketId: string;
    siteId: string;
    tenantId: string;
    authorId: string;
    body: string;
  }): Promise<TicketMessage> {
    return prisma.$transaction(async (tx) => {
      const message = await tx.ticket_messages.create({
        data: {
          ticketId: data.ticketId,
          siteId: data.siteId,
          tenantId: data.tenantId,
          authorType: 'USER',
          authorId: data.authorId,
          body: data.body,
        },
      });
      await tx.tickets.update({
        where: { id: data.ticketId },
        data: { updatedAt: new Date() },
      });
      return message;
    });
  }

  async close(id: string): Promise<void> {
    await prisma.tickets.update({
      where: { id },
      data: { status: 'CLOSED' },
    });
  }

  // --- Admin-scoped operations (PLATFORM_ADMIN = whole site, TENANT_ADMIN = own tenant) ---

  private adminWhere(scope: AdminScope): Prisma.ticketsWhereInput {
    const where: Prisma.ticketsWhereInput = { siteId: scope.siteId };
    if (scope.tenantId) where.tenantId = scope.tenantId;
    return where;
  }

  async listForScope(
    scope: AdminScope,
    query: AdminTicketListQuery,
  ): Promise<PageResult<TicketWithUser>> {
    const { page, pageSize } = normalizePageQuery(query);
    const where = this.adminWhere(scope);
    if (query.status === 'OPEN' || query.status === 'PENDING' || query.status === 'CLOSED') {
      where.status = query.status;
    }

    const [total, items] = await Promise.all([
      prisma.tickets.count({ where }),
      prisma.tickets.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { id: true, email: true } } },
      }),
    ]);
    return { page, pageSize, total, items };
  }

  /**
   * Loads a ticket within the admin scope. A ticket that exists but is outside
   * the caller's site/tenant is reported as NOT_FOUND so existence is not leaked.
   */
  async getForScope(id: string, scope: AdminScope): Promise<TicketDetailWithUser> {
    const ticket = await prisma.tickets.findFirst({
      where: { id, ...this.adminWhere(scope) },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        user: { select: { id: true, email: true } },
      },
    });
    if (!ticket) throw new AppError(ErrorCode.NOT_FOUND, 'ticket_not_found', 404);
    return ticket;
  }

  /**
   * Appends an ADMIN_USER reply and bumps updatedAt. When the ticket is CLOSED
   * an admin reply re-opens it to PENDING (awaiting the customer), so the
   * customer can respond again instead of being stuck on a closed thread.
   *
   * NOTE (milestone 3): the in-app notification for the ticket owner is produced
   * by the calling use-case (ReplyAdminTicketUseCase) after this write, not here.
   */
  async appendAdminMessage(data: {
    ticketId: string;
    siteId: string;
    tenantId: string;
    authorId: string;
    body: string;
    wasClosed: boolean;
  }): Promise<TicketMessage> {
    return prisma.$transaction(async (tx) => {
      const message = await tx.ticket_messages.create({
        data: {
          ticketId: data.ticketId,
          siteId: data.siteId,
          tenantId: data.tenantId,
          authorType: 'ADMIN_USER',
          authorId: data.authorId,
          body: data.body,
        },
      });
      await tx.tickets.update({
        where: { id: data.ticketId },
        data: data.wasClosed ? { status: 'PENDING', updatedAt: new Date() } : { updatedAt: new Date() },
      });
      return message;
    });
  }

  async updateStatus(id: string, status: 'OPEN' | 'PENDING' | 'CLOSED'): Promise<void> {
    await prisma.tickets.update({
      where: { id },
      data: { status },
    });
  }
}
