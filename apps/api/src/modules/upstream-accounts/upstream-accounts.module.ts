import { Module } from '@nestjs/common';
import { UpstreamAccountsController } from './upstream-accounts.controller';
import { UpstreamAccountsRepository } from './upstream-accounts.repository';
import { ConfigService } from '../../common/config/config.service';
import { ProvidersModule } from '../providers/providers.module';
import { ResourcesModule } from '../resources/resources.module';

@Module({
  imports: [ProvidersModule, ResourcesModule],
  controllers: [UpstreamAccountsController],
  providers: [UpstreamAccountsRepository, ConfigService],
  exports: [UpstreamAccountsRepository],
})
export class UpstreamAccountsModule {}
