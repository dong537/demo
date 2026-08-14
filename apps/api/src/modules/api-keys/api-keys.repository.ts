import { Injectable } from '@nestjs/common';
import { prisma, Prisma } from '@ipeasy/db';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PageQueryDto, PageResult, normalizePageQuery } from '../../common/pagination/pagination.dto';

export type ApiKey = Prisma.api_keysGetPayload<Record<string, never>>;

@Injectable()
export class ApiKeysRepository {
  async findByKeyHash(keyHash: string): Promise<ApiKey | null> {
    return prisma.api_keys.findUnique({ where: { keyHash } });
  }

  async findById(id: string): Promise<ApiKey> {
    const key = await prisma.api_keys.findUnique({ where: { id } });
    if (!key) throw new AppError(ErrorCode.NOT_FOUND, 'api_key_not_found', 404);
    return key;
  }

  async listForOwner(
    owner: { ownerId: string; siteId: string; tenantId: string },
    query: PageQueryDto,
  ): Promise<PageResult<ApiKey>> {
    const { page, pageSize } = normalizePageQuery(query);
    const where: Prisma.api_keysWhereInput = {
      ownerId: owner.ownerId,
      siteId: owner.siteId,
      tenantId: owner.tenantId,
    };

    const [total, items] = await Promise.all([
      prisma.api_keys.count({ where }),
      prisma.api_keys.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { page, pageSize, total, items };
  }

  async create(data: {
    siteId: string;
    tenantId: string;
    ownerId: string;
    ownerType: 'USER' | 'TENANT_ADMIN';
    name: string;
    keyHash: string;
    keyPrefix: string;
    scopes: string[];
    ipWhitelist: string[];
  }): Promise<ApiKey> {
    return prisma.api_keys.create({ data: { ...data, status: 'ACTIVE' } });
  }

  async revoke(id: string): Promise<void> {
    await prisma.api_keys.update({
      where: { id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
  }

  async updateLastUsed(id: string): Promise<void> {
    await prisma.api_keys.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }
}
