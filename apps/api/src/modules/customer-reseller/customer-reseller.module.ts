import { Module } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { WalletModule } from '../wallet/wallet.module';
import { CustomerResellerController } from './customer-reseller.controller';
import { CustomerResellerRepository } from './customer-reseller.repository';
import { ProvidersModule } from '../providers/providers.module';
import { FederatedUpstreamController } from './federated-upstream.controller';
import { FederatedUpstreamRepository } from './federated-upstream.repository';
import { FederatedUpstreamAdapter } from './federated-upstream.adapter';
import { FederatedUpstreamService } from './federated-upstream.service';

@Module({
  imports: [WalletModule, ProvidersModule],
  controllers: [CustomerResellerController, FederatedUpstreamController],
  providers: [CustomerResellerRepository, FederatedUpstreamRepository, FederatedUpstreamAdapter, FederatedUpstreamService, ConfigService],
})
export class CustomerResellerModule {}
