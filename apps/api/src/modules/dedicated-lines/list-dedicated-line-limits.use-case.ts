import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PageQueryDto, normalizePageQuery } from '../../common/pagination/pagination.dto';

@Injectable()
export class ListDedicatedLineLimitsUseCase {
  async execute(ctx: AuthenticatedContext, query: PageQueryDto = {}) {
    if (ctx.ownerType !== 'PLATFORM_ADMIN' && ctx.ownerType !== 'TENANT_ADMIN') {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'admin_only', 403);
    }

    const { page, pageSize } = normalizePageQuery(query);
    const where = {
      siteId: ctx.siteId,
      ...(ctx.ownerType === 'TENANT_ADMIN' ? { tenantId: ctx.tenantId ?? '' } : {}),
    };
    const [total, lines] = await Promise.all([
      prisma.dedicated_lines.count({ where }),
      prisma.dedicated_lines.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { email: true, name: true } },
          sku: { select: { code: true, name: true } },
          inboundProfile: { select: { inboundTag: true } },
          projections: { where: { migrationId: null }, select: { status: true } },
        },
      }),
    ]);

    const items = lines.map((line) => ({
      id: line.id,
      tenantId: line.tenantId,
      userId: line.userId,
      status: line.status,
      countryCode: line.countryCode,
      protocol: line.protocol,
      desiredVersion: line.desiredVersion,
      customer: line.user,
      sku: line.sku,
      inboundTag: line.inboundProfile.inboundTag,
      limits: {
        trafficLimitBytes: (line.quotaBytes ?? 0n).toString(),
        uplinkLimitBps: (line.uplinkLimitBps ?? 0n).toString(),
        downlinkLimitBps: (line.downlinkLimitBps ?? 0n).toString(),
        maxConnections: line.maxConnections ?? 0,
        ipLimit: line.ipLimit ?? 0,
      },
      projections: {
        ready: line.projections.filter((projection) => projection.status === 'READY').length,
        total: line.projections.length,
      },
    }));
    return { page, pageSize, total, items };
  }
}
