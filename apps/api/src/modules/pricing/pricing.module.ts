import { Module } from '@nestjs/common';
import { PricingRepository } from './pricing.repository';
import { PricingController } from './pricing.controller';
import { QuoteUseCase } from './use-cases/quote.use-case';
import { ResourcesModule } from '../resources/resources.module';

@Module({
  imports: [ResourcesModule],
  providers: [PricingRepository, QuoteUseCase],
  controllers: [PricingController],
  exports: [PricingRepository, QuoteUseCase],
})
export class PricingModule {}
