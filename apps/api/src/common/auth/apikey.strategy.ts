import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';
import { AuthenticatedContext, OwnerType } from './auth-context';
import { ApiKeysRepository } from '../../modules/api-keys/api-keys.repository';
import { requestIdStorage } from '../logging/request-id.context';

@Injectable()
export class ApiKeyStrategy {
  constructor(private readonly apiKeysRepo: ApiKeysRepository) {}

  async authenticate(rawKey: string, clientIp: string): Promise<AuthenticatedContext> {
    const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const apiKey = await this.apiKeysRepo.findByKeyHash(hash);

    if (!apiKey || apiKey.status !== 'ACTIVE') {
      throw new AppError(ErrorCode.AUTH_REQUIRED, 'invalid_api_key', 401);
    }

    if (apiKey.ipWhitelist.length > 0 && !apiKey.ipWhitelist.includes(clientIp)) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'ip_not_whitelisted', 403);
    }

    await this.apiKeysRepo.updateLastUsed(apiKey.id);

    const ownerType: OwnerType = apiKey.ownerType === 'USER' ? 'USER' : 'TENANT_ADMIN';
    const requestId = requestIdStorage.getStore() ?? '';

    return {
      ownerId: apiKey.ownerId,
      ownerType,
      siteId: apiKey.siteId,
      tenantId: apiKey.tenantId,
      scopes: apiKey.scopes,
      requestId,
    };
  }
}
