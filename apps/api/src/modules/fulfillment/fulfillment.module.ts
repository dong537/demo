import { Module } from '@nestjs/common';
import { FulfillmentRepository } from './fulfillment.repository';
import { FulfillStaticProxyUseCase } from './use-cases/fulfill-static-proxy.use-case';
import { ProvidersModule } from '../providers/providers.module';
import { ConfigService } from '../../common/config/config.service';
import { WalletRepository } from '../wallet/wallet.repository';
import { ProxiesRepository } from '../proxies/proxies.repository';

@Module({
  imports: [ProvidersModule],
  providers: [FulfillmentRepository, FulfillStaticProxyUseCase, WalletRepository, ProxiesRepository, ConfigService],
  exports: [FulfillmentRepository, FulfillStaticProxyUseCase],
})
export class FulfillmentModule {}
