import { Injectable } from '@nestjs/common';
import { prisma, Prisma } from '@ipeasy/db';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PageQueryDto, PageResult, normalizePageQuery } from '../../common/pagination/pagination.dto';
import { SelfUserScope } from './access';

type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'BANNED';

export type AdminUserListItem = {
  id: string;
  email: string;
  tenantId: string;
  status: UserStatus;
  kycStatus: string;
  createdAt: Date;
};

export type UserProfile = {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  status: string;
  kycStatus: string;
  riskStatus: string;
};

export type UserOrderContext = {
  id: string;
  siteId: string;
  tenantId: string;
};

@Injectable()
export class UsersRepository {
  async findOrderContextByIdInSite(userId: string, siteId: string): Promise<UserOrderContext | null> {
    return prisma.users.findFirst({
      where: { id: userId, siteId },
      select: {
        id: true,
        siteId: true,
        tenantId: true,
      },
    });
  }

  /**
   * Reads the caller's own profile. Scoped by id + site + tenant so a session
   * whose tenant context drifted cannot read another tenant's row; a missing row
   * is reported as NOT_FOUND. Never selects passwordHash.
   */
  async getSelfProfile(owner: SelfUserScope): Promise<UserProfile> {
    const user = await prisma.users.findFirst({
      where: { id: owner.userId, siteId: owner.siteId, tenantId: owner.tenantId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        status: true,
        kycStatus: true,
        riskStatus: true,
      },
    });
    if (!user) throw new AppError(ErrorCode.NOT_FOUND, 'user_not_found', 404);
    return user;
  }

  /**
   * Updates the caller's editable profile fields (name/phone only). email stays
   * read-only at this layer to avoid @unique churn. Scoped by id + site + tenant.
   */
  async updateSelfProfile(
    owner: SelfUserScope,
    data: { name: string | null; phone: string | null },
  ): Promise<UserProfile> {
    const result = await prisma.users.updateMany({
      where: { id: owner.userId, siteId: owner.siteId, tenantId: owner.tenantId },
      data: { name: data.name, phone: data.phone },
    });
    if (result.count === 0) throw new AppError(ErrorCode.NOT_FOUND, 'user_not_found', 404);
    return this.getSelfProfile(owner);
  }

  async listUsers(
    siteId: string,
    tenantId: string | null,
    query: PageQueryDto & { status?: UserStatus },
  ): Promise<PageResult<AdminUserListItem>> {
    const { page, pageSize } = normalizePageQuery(query);
    const where: Prisma.usersWhereInput = { siteId };
    if (tenantId) where.tenantId = tenantId;
    if (query.status) where.status = query.status;
    if (query.search) {
      where.email = { contains: query.search, mode: 'insensitive' };
    }

    const [total, items] = await Promise.all([
      prisma.users.count({ where }),
      prisma.users.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          email: true,
          tenantId: true,
          status: true,
          kycStatus: true,
          createdAt: true,
        },
      }),
    ]);

    return { page, pageSize, total, items };
  }
}
