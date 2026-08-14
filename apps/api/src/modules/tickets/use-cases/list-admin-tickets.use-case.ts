import { Injectable } from '@nestjs/common';
import { TicketsRepository } from '../tickets.repository';
import { AdminTicketListItemDto } from '../dto';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { PageQueryDto, PageResult } from '../../../common/pagination/pagination.dto';
import { requireTicketAdminScope } from '../admin-access';
import { toAdminTicketListItem } from '../mappers';

@Injectable()
export class ListAdminTicketsUseCase {
  constructor(private readonly repo: TicketsRepository) {}

  async execute(
    ctx: AuthenticatedContext,
    query: PageQueryDto & { status?: string },
  ): Promise<PageResult<AdminTicketListItemDto>> {
    const scope = requireTicketAdminScope(ctx);
    const result = await this.repo.listForScope(scope, query);
    return { ...result, items: result.items.map(toAdminTicketListItem) };
  }
}
