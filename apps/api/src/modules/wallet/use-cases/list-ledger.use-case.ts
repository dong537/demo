import { Injectable } from '@nestjs/common';
import { WalletRepository, LedgerEntry } from '../wallet.repository';
import { LedgerEntryDto } from '../dto';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { PageQueryDto, PageResult } from '../../../common/pagination/pagination.dto';
import { LedgerEntryType } from '@ipeasy/db';
import { getWalletForContext } from '../access';

@Injectable()
export class ListLedgerUseCase {
  constructor(private readonly repo: WalletRepository) {}

  async execute(
    ctx: AuthenticatedContext,
    userId: string,
    query: PageQueryDto & { type?: LedgerEntryType; from?: string; to?: string },
  ): Promise<PageResult<LedgerEntryDto>> {
    const wallet = await getWalletForContext(this.repo, ctx, userId);
    const result = await this.repo.listLedgerEntries(wallet.id, wallet.tenantId, query);

    return {
      ...result,
      items: result.items.map(toDto),
    };
  }
}

function toDto(e: LedgerEntry): LedgerEntryDto {
  return {
    id: e.id,
    type: e.type,
    amount: e.amount.toString(),
    balanceAfter: e.balanceAfter.toString(),
    currency: e.currency,
    relatedId: e.relatedId,
    reason: e.reason,
    createdAt: e.createdAt,
  };
}
