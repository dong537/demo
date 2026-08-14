import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersRepository } from './orders.repository';
import { AdminOrderOperationsUseCase } from './use-cases/admin-order-operations.use-case';
import { WalletModule } from '../wallet/wallet.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [WalletModule, AuthModule],
  controllers: [OrdersController],
  providers: [OrdersRepository, AdminOrderOperationsUseCase],
  exports: [OrdersRepository, AdminOrderOperationsUseCase],
})
export class OrdersModule {}
