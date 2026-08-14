import { Module } from '@nestjs/common';
import { DedicatedLineProjectionsModule } from '../dedicated-line-projections/dedicated-line-projections.module';
import { ProcessControlNodeHealthUseCase } from './control-node-health.use-case';
import { ListDedicatedLineRecommendationsUseCase } from './list-recommendations.use-case';

@Module({ imports: [DedicatedLineProjectionsModule], providers: [ProcessControlNodeHealthUseCase, ListDedicatedLineRecommendationsUseCase], exports: [ProcessControlNodeHealthUseCase, ListDedicatedLineRecommendationsUseCase] })
export class DedicatedLineHealthModule {}
