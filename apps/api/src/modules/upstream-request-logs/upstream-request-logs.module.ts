import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module';
import { UpstreamRequestLogsController } from './upstream-request-logs.controller';
import { ListUpstreamLogsUseCase } from './list-upstream-logs.use-case';

@Module({
  imports: [ProvidersModule],
  controllers: [UpstreamRequestLogsController],
  providers: [ListUpstreamLogsUseCase],
})
export class UpstreamRequestLogsModule {}
