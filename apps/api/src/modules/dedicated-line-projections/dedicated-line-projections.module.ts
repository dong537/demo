import { Module } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { DedicatedLineProjectionRepository } from './dedicated-line-projection.repository';
import { ManagedLineProjectionAdapter } from './managed-line-projection.adapter';
import { ProcessDedicatedLineProjectionUseCase } from './process-dedicated-line-projection.use-case';

@Module({
  providers: [
    ConfigService,
    DedicatedLineProjectionRepository,
    {
      provide: ManagedLineProjectionAdapter,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new ManagedLineProjectionAdapter(config),
    },
    ProcessDedicatedLineProjectionUseCase,
  ],
  exports: [DedicatedLineProjectionRepository, ProcessDedicatedLineProjectionUseCase, ManagedLineProjectionAdapter],
})
export class DedicatedLineProjectionsModule {}
