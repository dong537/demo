import { Module } from '@nestjs/common';
import { ProxiesController } from './proxies.controller';
import { ProxiesRepository } from './proxies.repository';
import { RenewProxyUseCase } from './use-cases/renew-proxy.use-case';
import { ChangePasswordUseCase } from './use-cases/change-password.use-case';
import { SwitchIpUseCase } from './use-cases/switch-ip.use-case';
import { BatchProxyLifecycleUseCase } from './use-cases/batch-proxy-lifecycle.use-case';
import { ProxyLifecycleService } from './proxy-lifecycle.service';
import { ProxyAuditService } from './proxy-audit.service';
import { ProvidersModule } from '../providers/providers.module';
import { ConfigService } from '../../common/config/config.service';

@Module({
  imports: [ProvidersModule],
  controllers: [ProxiesController],
  providers: [ProxiesRepository, ProxyAuditService, ProxyLifecycleService, RenewProxyUseCase, ChangePasswordUseCase, SwitchIpUseCase, BatchProxyLifecycleUseCase, ConfigService],
  exports: [ProxiesRepository, RenewProxyUseCase, ChangePasswordUseCase, SwitchIpUseCase, ProxyAuditService],
})
export class ProxiesModule {}
