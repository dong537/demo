import { Module } from '@nestjs/common';
import { ResourcesRepository } from './resources.repository';
import { ResourcesController } from './resources.controller';
import { SyncInventoryUseCase } from './use-cases/sync-inventory.use-case';
import { ProvidersModule } from '../providers/providers.module';
import { DedicatedLineOrdersModule } from '../dedicated-line-orders/dedicated-line-orders.module';

@Module({
  imports: [ProvidersModule, DedicatedLineOrdersModule],
  providers: [ResourcesRepository, SyncInventoryUseCase],
  controllers: [ResourcesController],
  exports: [ResourcesRepository, SyncInventoryUseCase],
})
export class ResourcesModule {}
