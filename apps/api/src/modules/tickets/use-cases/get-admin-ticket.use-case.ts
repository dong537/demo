import { Injectable } from '@nestjs/common';
import { TicketsRepository } from '../tickets.repository';
import { AdminTicketDetailDto } from '../dto';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { requireTicketAdminScope } from '../admin-access';
import { toAdminTicketDetail } from '../mappers';

@Injectable()
export class GetAdminTicketUseCase {
  constructor(private readonly repo: TicketsRepository) {}

  async execute(ctx: AuthenticatedContext, id: string): Promise<AdminTicketDetailDto> {
    const scope = requireTicketAdminScope(ctx);
    const ticket = await this.repo.getForScope(id, scope);
    return toAdminTicketDetail(ticket);
  }
}
