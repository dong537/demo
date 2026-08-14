import { Controller, Post, Delete, Get, Body, Param, Query } from '@nestjs/common';
import { CreateApiKeyUseCase } from './use-cases/create-api-key.use-case';
import { RevokeApiKeyUseCase } from './use-cases/revoke-api-key.use-case';
import { ListApiKeysUseCase } from './use-cases/list-api-keys.use-case';
import { CreateApiKeyDto, ApiKeyResponseDto, ApiKeyListItemDto } from './dto';
import { RequireAuth } from '../../common/auth/guards';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { PageQueryDto, PageResult } from '../../common/pagination/pagination.dto';

@Controller('api-keys')
export class ApiKeysController {
  constructor(
    private readonly createUseCase: CreateApiKeyUseCase,
    private readonly revokeUseCase: RevokeApiKeyUseCase,
    private readonly listUseCase: ListApiKeysUseCase,
  ) {}

  @Get()
  @RequireAuth()
  async list(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: PageQueryDto,
  ): Promise<PageResult<ApiKeyListItemDto>> {
    return this.listUseCase.execute(ctx, query);
  }

  @Post()
  @RequireAuth()
  async create(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: CreateApiKeyDto,
  ): Promise<ApiKeyResponseDto> {
    return this.createUseCase.execute(ctx, body);
  }

  @Delete(':id')
  @RequireAuth()
  async revoke(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
  ): Promise<void> {
    await this.revokeUseCase.execute(ctx, id);
  }
}
