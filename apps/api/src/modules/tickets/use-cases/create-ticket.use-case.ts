import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { TicketsRepository, TicketWithMessages } from '../tickets.repository';
import { CreateTicketDto, TicketDetailDto } from '../dto';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { requestIdStorage } from '../../../common/logging/request-id.context';
import { requireTicketOwner, requireNonEmpty } from '../access';
import { toTicketDetail } from '../mappers';

@Injectable()
export class CreateTicketUseCase {
  constructor(private readonly repo: TicketsRepository) {}

  async execute(ctx: AuthenticatedContext, dto: CreateTicketDto): Promise<TicketDetailDto> {
    const owner = requireTicketOwner(ctx);
    const subject = requireNonEmpty(dto.subject, 'subject_required');
    const body = requireNonEmpty(dto.body, 'body_required');

    const ticket: TicketWithMessages = await this.repo.createWithFirstMessage({
      siteId: owner.siteId,
      tenantId: owner.tenantId,
      userId: owner.ownerId,
      subject,
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
        action: 'ticket.create',
        requestId,
      },
    });

    return toTicketDetail(ticket);
  }
}
