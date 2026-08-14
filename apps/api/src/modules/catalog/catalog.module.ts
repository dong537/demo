import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogRepository } from './catalog.repository';
import { SkuQuoteUseCase } from './domain';

@Module({
  controllers: [CatalogController],
  providers: [
    CatalogRepository,
    {
      provide: SkuQuoteUseCase,
      inject: [CatalogRepository],
      useFactory: (repository: CatalogRepository) => new SkuQuoteUseCase(repository),
    },
  ],
  exports: [CatalogRepository, SkuQuoteUseCase],
})
export class CatalogModule {}
