import { Module } from '@nestjs/common';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysRepository } from './api-keys.repository';
import { CreateApiKeyUseCase } from './use-cases/create-api-key.use-case';
import { RevokeApiKeyUseCase } from './use-cases/revoke-api-key.use-case';
import { ListApiKeysUseCase } from './use-cases/list-api-keys.use-case';

@Module({
  controllers: [ApiKeysController],
  providers: [ApiKeysRepository, CreateApiKeyUseCase, RevokeApiKeyUseCase, ListApiKeysUseCase],
})
export class ApiKeysModule {}
