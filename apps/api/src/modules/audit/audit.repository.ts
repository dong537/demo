import { Injectable } from '@nestjs/common';
import { prisma, Prisma } from '@ipeasy/db';
import { PageQueryDto, PageResult, normalizePageQuery } from '../../common/pagination/pagination.dto';

type AuditActorType = 'USER' | 'ADMIN_USER' | 'SYSTEM' | 'APIKEY';

export type AuditLogListItem = {
  id: string;
  action: string;
  actorType: AuditActorType;
  actorId: string;
  targetType: string | null;
  targetId: string | null;
  requestId: string;
  createdAt: Date;
};

@Injectable()
export class AuditRepository {
  async listAuditLogs(
    siteId: string,
    tenantId: string | null,
    query: PageQueryDto & { action?: string; actorType?: AuditActorType },
  ): Promise<PageResult<AuditLogListItem>> {
    const { page, pageSize } = normalizePageQuery(query);
    const where: Prisma.audit_logsWhereInput = { siteId };
    if (tenantId) where.tenantId = tenantId;
    if (query.action) where.action = query.action;
    if (query.actorType) where.actorType = query.actorType;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const [total, items] = await Promise.all([
      prisma.audit_logs.count({ where }),
      prisma.audit_logs.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          action: true,
          actorType: true,
          actorId: true,
          targetType: true,
          targetId: true,
          requestId: true,
          createdAt: true,
        },
      }),
    ]);

    return { page, pageSize, total, items };
  }
}
