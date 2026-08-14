import { Module } from '@nestjs/common';
import { ProxyCheckController } from './proxy-check.controller';
import { CheckProxyUseCase } from './use-cases/check-proxy.use-case';
import { HttpProxyProber, PROXY_PROBER } from './proxy-prober';
import { ProxiesModule } from '../proxies/proxies.module';
import { ConfigService } from '../../common/config/config.service';

@Module({
  imports: [ProxiesModule],
  controllers: [ProxyCheckController],
  providers: [
    CheckProxyUseCase,
    ConfigService,
    { provide: PROXY_PROBER, useClass: HttpProxyProber },
  ],
})
export class ProxyCheckModule {}
