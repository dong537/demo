import { Module } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { AuthModule } from '../auth/auth.module';
import { ProductionReadinessController } from './production-readiness.controller';
import { ProductionReadinessRepository } from './production-readiness.repository';
import { ProductionReadinessUseCase } from './production-readiness.use-case';

@Module({
  imports: [AuthModule],
  controllers: [ProductionReadinessController],
  providers: [ConfigService, ProductionReadinessRepository, ProductionReadinessUseCase],
})
export class ProductionReadinessModule {}
