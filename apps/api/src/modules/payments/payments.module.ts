import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsRepository } from './payments.repository';
import { CreatePaymentOrderUseCase } from './use-cases/create-payment-order.use-case';
import { ConfirmPaymentOrderUseCase } from './use-cases/confirm-payment-order.use-case';
import { WalletModule } from '../wallet/wallet.module';
import { ConfigService } from '../../common/config/config.service';

@Module({
  imports: [WalletModule],
  controllers: [PaymentsController],
  providers: [PaymentsRepository, CreatePaymentOrderUseCase, ConfirmPaymentOrderUseCase, ConfigService],
})
export class PaymentsModule {}
