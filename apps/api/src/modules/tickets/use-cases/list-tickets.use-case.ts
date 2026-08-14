import { Injectable } from '@nestjs/common';
import { TicketsRepository } from '../tickets.repository';
import { TicketListItemDto } from '../dto';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { PageQueryDto, PageResult } from '../../../common/pagination/pagination.dto';
import { requireTicketOwner } from '../access';
import { toTicketListItem } from '../mappers';

@Injectable()
export class ListTicketsUseCase {
  constructor(private readonly repo: TicketsRepository) {}

  async execute(
    ctx: AuthenticatedContext,
    query: PageQueryDto,
  ): Promise<PageResult<TicketListItemDto>> {
    const owner = requireTicketOwner(ctx);
    const result = await this.repo.listForOwner(owner, query);
    return { ...result, items: result.items.map(toTicketListItem) };
  }
}
