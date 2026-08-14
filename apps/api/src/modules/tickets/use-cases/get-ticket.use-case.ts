import { Injectable } from '@nestjs/common';
import { TicketsRepository } from '../tickets.repository';
import { TicketDetailDto } from '../dto';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { requireTicketOwner } from '../access';
import { toTicketDetail } from '../mappers';

@Injectable()
export class GetTicketUseCase {
  constructor(private readonly repo: TicketsRepository) {}

  async execute(ctx: AuthenticatedContext, id: string): Promise<TicketDetailDto> {
    const owner = requireTicketOwner(ctx);
    const ticket = await this.repo.getOwnedWithMessages(id, owner);
    return toTicketDetail(ticket);
  }
}
