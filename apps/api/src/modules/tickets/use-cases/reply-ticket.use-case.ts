import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { TicketsRepository } from '../tickets.repository';
import { ReplyTicketDto, TicketDetailDto } from '../dto';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { requestIdStorage } from '../../../common/logging/request-id.context';
import { requireTicketOwner, requireNonEmpty } from '../access';
import { toTicketDetail } from '../mappers';

@Injectable()
export class ReplyTicketUseCase {
  constructor(private readonly repo: TicketsRepository) {}

  async execute(
    ctx: AuthenticatedContext,
    id: string,
    dto: ReplyTicketDto,
  ): Promise<TicketDetailDto> {
    const owner = requireTicketOwner(ctx);
    const body = requireNonEmpty(dto.body, 'body_required');

    const ticket = await this.repo.getOwned(id, owner);
    if (ticket.status === 'CLOSED') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'ticket_closed', 400);
    }

    await this.repo.appendUserMessage({
      ticketId: ticket.id,
      siteId: owner.siteId,
      tenantId: owner.tenantId,
      authorId: owner.ownerId,
      body,
    });

    const requestId = requestIdStorage.getStore() ?? '';
    await prisma.audit_logs.create({
      data: {
        siteId: owner.siteId,
        tenantId: owner.tenantId,
        actorType: 'USER',
        actorId: owner.ownerId,
        targetType: 'ticket',
        targetId: ticket.id,
        action: 'ticket.reply',
        requestId,
      },
    });

    const updated = await this.repo.getOwnedWithMessages(ticket.id, owner);
    return toTicketDetail(updated);
  }
}
