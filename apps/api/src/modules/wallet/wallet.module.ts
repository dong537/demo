import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletRepository } from './wallet.repository';
import { GetWalletUseCase } from './use-cases/get-wallet.use-case';
import { ListLedgerUseCase } from './use-cases/list-ledger.use-case';
import { AdjustWalletUseCase } from './use-cases/adjust-wallet.use-case';

@Module({
  controllers: [WalletController],
  providers: [WalletRepository, GetWalletUseCase, ListLedgerUseCase, AdjustWalletUseCase],
  exports: [WalletRepository],
})
export class WalletModule {}
