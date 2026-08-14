import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { TicketsRepository } from '../tickets.repository';
import { UpdateTicketStatusDto, AdminTicketDetailDto } from '../dto';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { requestIdStorage } from '../../../common/logging/request-id.context';
import { requireTicketAdminScope, requireTicketStatus } from '../admin-access';
import { toAdminTicketDetail } from '../mappers';

@Injectable()
export class UpdateAdminTicketStatusUseCase {
  constructor(private readonly repo: TicketsRepository) {}

  async execute(
    ctx: AuthenticatedContext,
    id: string,
    dto: UpdateTicketStatusDto,
  ): Promise<AdminTicketDetailDto> {
    const scope = requireTicketAdminScope(ctx);
    const status = requireTicketStatus(dto.status);

    const ticket = await this.repo.getForScope(id, scope);

    if (ticket.status !== status) {
      await this.repo.updateStatus(ticket.id, status);

      const requestId = requestIdStorage.getStore() ?? '';
      await prisma.audit_logs.create({
        data: {
          siteId: ticket.siteId,
          tenantId: ticket.tenantId,
          actorType: 'ADMIN_USER',
          actorId: ctx.ownerId,
          targetType: 'ticket',
          targetId: ticket.id,
          action: 'ticket.status_change',
          requestId,
        },
      });
    }

    const updated = await this.repo.getForScope(ticket.id, scope);
    return toAdminTicketDetail(updated);
  }
}
