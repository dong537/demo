import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { TicketsRepository } from '../tickets.repository';
import { AdminReplyTicketDto, AdminTicketDetailDto } from '../dto';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { requestIdStorage } from '../../../common/logging/request-id.context';
import { LoggerService } from '../../../common/logging/logger.service';
import { NotificationsRepository } from '../../notifications/notifications.repository';
import { requireTicketAdminScope } from '../admin-access';
import { requireNonEmpty } from '../access';
import { toAdminTicketDetail } from '../mappers';

const NOTIFICATION_BODY_MAX = 200;

/**
 * Admin reply to a customer ticket. This use-case is the single source of an
 * admin-originated ticket message and the sole production point for in-app
 * notifications: after the reply is persisted it writes one `ticket_reply`
 * notification for `ticket.userId`.
 *
 * Failure strategy (intentionally different from the audit write below): the
 * reply is the primary operation, so a notification write failure must NOT fail
 * the request or roll back the reply. It is caught and logged at error level so
 * the failure is observable, never silently swallowed. The audit write, by
 * contrast, is a compliance record and is left to fail the request if it errors.
 */
@Injectable()
export class ReplyAdminTicketUseCase {
  constructor(
    private readonly repo: TicketsRepository,
    private readonly notifications: NotificationsRepository,
    private readonly logger: LoggerService,
  ) {}

  async execute(
    ctx: AuthenticatedContext,
    id: string,
    dto: AdminReplyTicketDto,
  ): Promise<AdminTicketDetailDto> {
    const scope = requireTicketAdminScope(ctx);
    const body = requireNonEmpty(dto.body, 'body_required');

    // Loads + scope-checks the ticket (NOT_FOUND if outside site/tenant).
    const ticket = await this.repo.getForScope(id, scope);

    await this.repo.appendAdminMessage({
      ticketId: ticket.id,
      // Use the ticket's own site/tenant: a PLATFORM_ADMIN scope has tenantId=null,
      // so the message must inherit the ticket's real tenant, not the scope's.
      siteId: ticket.siteId,
      tenantId: ticket.tenantId,
      authorId: ctx.ownerId,
      body,
      wasClosed: ticket.status === 'CLOSED',
    });

    const requestId = requestIdStorage.getStore() ?? '';
    await prisma.audit_logs.create({
      data: {
        siteId: ticket.siteId,
        tenantId: ticket.tenantId,
        actorType: 'ADMIN_USER',
        actorId: ctx.ownerId,
        targetType: 'ticket',
        targetId: ticket.id,
        action: 'ticket.admin_reply',
        requestId,
      },
    });

    await this.produceReplyNotification(ticket, body);

    const updated = await this.repo.getForScope(ticket.id, scope);
    return toAdminTicketDetail(updated);
  }

  /**
   * Writes the in-app notification for the ticket owner. Inherits the ticket's
   * own site/tenant (the admin scope may be site-wide). Non-fatal: a failure
   * here is logged, not propagated, so the admin reply still succeeds.
   */
  private async produceReplyNotification(
    ticket: { id: string; siteId: string; tenantId: string; userId: string; subject: string },
    replyBody: string,
  ): Promise<void> {
    try {
      await this.notifications.createForUser({
        siteId: ticket.siteId,
        tenantId: ticket.tenantId,
        userId: ticket.userId,
        type: 'ticket_reply',
        title: ticket.subject,
        body:
          replyBody.length > NOTIFICATION_BODY_MAX
            ? `${replyBody.slice(0, NOTIFICATION_BODY_MAX)}…`
            : replyBody,
        relatedType: 'ticket',
        relatedId: ticket.id,
      });
    } catch (error) {
      this.logger.error('notification.ticket_reply.write_failed', {
        ticketId: ticket.id,
        userId: ticket.userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
