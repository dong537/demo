import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { ApiKeysRepository, ApiKey } from '../api-keys.repository';
import { ApiKeyListItemDto } from '../dto';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { PageQueryDto, PageResult } from '../../../common/pagination/pagination.dto';

@Injectable()
export class ListApiKeysUseCase {
  constructor(private readonly repo: ApiKeysRepository) {}

  async execute(
    ctx: AuthenticatedContext,
    query: PageQueryDto,
  ): Promise<PageResult<ApiKeyListItemDto>> {
    if (ctx.ownerType !== 'USER' && ctx.ownerType !== 'TENANT_ADMIN') {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
    }
    if (!ctx.tenantId) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
    }

    const result = await this.repo.listForOwner(
      { ownerId: ctx.ownerId, siteId: ctx.siteId, tenantId: ctx.tenantId },
      query,
    );

    return {
      ...result,
      items: result.items.map(toDto),
    };
  }
}

function toDto(key: ApiKey): ApiKeyListItemDto {
  return {
    id: key.id,
    name: key.name,
    keyPrefix: key.keyPrefix,
    scopes: key.scopes,
    ipWhitelist: key.ipWhitelist,
    status: key.status,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
    revokedAt: key.revokedAt,
  };
}
