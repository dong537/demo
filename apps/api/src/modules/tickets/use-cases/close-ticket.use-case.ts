import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { TicketsRepository } from '../tickets.repository';
import { TicketDetailDto } from '../dto';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { requestIdStorage } from '../../../common/logging/request-id.context';
import { requireTicketOwner } from '../access';
import { toTicketDetail } from '../mappers';

@Injectable()
export class CloseTicketUseCase {
  constructor(private readonly repo: TicketsRepository) {}

  async execute(ctx: AuthenticatedContext, id: string): Promise<TicketDetailDto> {
    const owner = requireTicketOwner(ctx);
    const ticket = await this.repo.getOwned(id, owner);

    if (ticket.status !== 'CLOSED') {
      await this.repo.close(ticket.id);

      const requestId = requestIdStorage.getStore() ?? '';
      await prisma.audit_logs.create({
        data: {
          siteId: owner.siteId,
          tenantId: owner.tenantId,
          actorType: 'USER',
          actorId: owner.ownerId,
          targetType: 'ticket',
          targetId: ticket.id,
          action: 'ticket.close',
          requestId,
        },
      });
    }

    const updated = await this.repo.getOwnedWithMessages(ticket.id, owner);
    return toTicketDetail(updated);
  }
}
