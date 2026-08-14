import { Module } from '@nestjs/common';
import { ProviderRegistryService } from './provider-registry.service';
import { UpstreamLogRepository } from './upstream-log.repository';
import { ProvidersRepository } from './providers.repository';
import { ProvidersController } from './providers.controller';
import { ListProvidersUseCase } from './use-cases/list-providers.use-case';
import { HealthCheckProviderUseCase } from './use-cases/health-check-provider.use-case';
import { IpipdAdapter } from './adapters/ipipd.adapter';
import { NineEightFiveAdapter } from './adapters/nine-eight-five.adapter';
import { PrAdapter } from './adapters/pr.adapter';
import { UpstreamApiAdapter } from './adapters/upstream-api.adapter';
import { ConfigService } from '../../common/config/config.service';
import { AuthModule } from '../auth/auth.module';

const ADAPTERS = [IpipdAdapter, NineEightFiveAdapter, PrAdapter, UpstreamApiAdapter];

@Module({
  imports: [AuthModule],
  controllers: [ProvidersController],
  providers: [
    ...ADAPTERS,
    UpstreamLogRepository,
    ProvidersRepository,
    ConfigService,
    ListProvidersUseCase,
    HealthCheckProviderUseCase,
    {
      provide: ProviderRegistryService,
      useFactory: (config: ConfigService, logRepo: UpstreamLogRepository, ipipd: IpipdAdapter, nef: NineEightFiveAdapter, pr: PrAdapter, upstreamApi: UpstreamApiAdapter) =>
        new ProviderRegistryService(config, logRepo, [ipipd, nef, pr, upstreamApi]),
      inject: [ConfigService, UpstreamLogRepository, IpipdAdapter, NineEightFiveAdapter, PrAdapter, UpstreamApiAdapter],
    },
  ],
  exports: [ProviderRegistryService, ProvidersRepository, UpstreamLogRepository, UpstreamApiAdapter],
})
export class ProvidersModule {}
