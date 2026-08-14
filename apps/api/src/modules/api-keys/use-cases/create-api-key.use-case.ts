import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { prisma } from '@ipeasy/db';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { ApiKeysRepository } from '../api-keys.repository';
import { CreateApiKeyDto, ApiKeyResponseDto } from '../dto';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { requestIdStorage } from '../../../common/logging/request-id.context';

@Injectable()
export class CreateApiKeyUseCase {
  constructor(private readonly repo: ApiKeysRepository) {}

  async execute(ctx: AuthenticatedContext, dto: CreateApiKeyDto): Promise<ApiKeyResponseDto> {
    if (ctx.ownerType !== 'USER' && ctx.ownerType !== 'TENANT_ADMIN') {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
    }
    if (ctx.tenantId !== dto.tenantId) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
    }
    const name = dto.name?.trim();
    if (!name) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'api_key_name_required', 400);
    }
    if (name.length > 80) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'api_key_name_too_long', 400);
    }
    if (!Array.isArray(dto.scopes) || dto.scopes.length === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'api_key_scopes_required', 400);
    }

    const plainKey = crypto.randomBytes(32).toString('hex');
    const keyPrefix = plainKey.slice(0, 8);
    const keyHash = crypto.createHash('sha256').update(plainKey).digest('hex');

    const apiKey = await this.repo.create({
      siteId: ctx.siteId,
      tenantId: dto.tenantId,
      ownerId: ctx.ownerId,
      ownerType: ctx.ownerType as 'USER' | 'TENANT_ADMIN',
      name,
      keyHash,
      keyPrefix,
      scopes: dto.scopes,
      ipWhitelist: dto.ipWhitelist ?? [],
    });

    const requestId = requestIdStorage.getStore() ?? '';
    await prisma.audit_logs.create({
      data: {
        siteId: ctx.siteId,
        tenantId: ctx.tenantId,
        actorType: ctx.ownerType === 'USER' ? 'USER' : 'ADMIN_USER',
        actorId: ctx.ownerId,
        targetType: 'api_key',
        targetId: apiKey.id,
        action: 'api_key.create',
        requestId,
      },
    });

    return {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      scopes: apiKey.scopes,
      ipWhitelist: apiKey.ipWhitelist,
      status: apiKey.status,
      createdAt: apiKey.createdAt,
      plainKey,
    };
  }
}
