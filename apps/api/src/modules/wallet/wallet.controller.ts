import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { GetWalletUseCase } from './use-cases/get-wallet.use-case';
import { ListLedgerUseCase } from './use-cases/list-ledger.use-case';
import { AdjustWalletUseCase } from './use-cases/adjust-wallet.use-case';
import { AdjustWalletDto, WalletDto, LedgerEntryDto } from './dto';
import { RequireAuth } from '../../common/auth/guards';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { PageQueryDto, PageResult } from '../../common/pagination/pagination.dto';
import { LedgerEntryType } from '@ipeasy/db';

@Controller('wallet')
export class WalletController {
  constructor(
    private readonly getWallet: GetWalletUseCase,
    private readonly listLedger: ListLedgerUseCase,
    private readonly adjustWallet: AdjustWalletUseCase,
  ) {}

  @Get(':userId')
  @RequireAuth()
  async get(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('userId') userId: string,
  ): Promise<WalletDto> {
    return this.getWallet.execute(ctx, userId);
  }

  @Get(':userId/ledger')
  @RequireAuth()
  async ledger(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('userId') userId: string,
    @Query() query: PageQueryDto & { type?: LedgerEntryType; from?: string; to?: string },
  ): Promise<PageResult<LedgerEntryDto>> {
    return this.listLedger.execute(ctx, userId, query);
  }

  @Post(':userId/adjust')
  @RequireAuth()
  async adjust(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('userId') userId: string,
    @Body() body: AdjustWalletDto,
  ): Promise<WalletDto> {
    return this.adjustWallet.execute(ctx, userId, body);
  }
}
