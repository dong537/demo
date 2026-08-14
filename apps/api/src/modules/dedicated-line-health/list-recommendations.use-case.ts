import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { AuthenticatedContext, requireOperatorContext } from '../../common/auth/auth-context';

@Injectable()
export class ListDedicatedLineRecommendationsUseCase {
  async execute(ctx: AuthenticatedContext) {
    requireOperatorContext(ctx);
    return prisma.dedicated_line_migration_recommendations.findMany({
      where: { siteId: ctx.siteId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      include: { sourceNode: { select: { id: true, code: true, regionCode: true } }, dedicatedLine: { select: { id: true, countryCode: true, status: true, desiredVersion: true } }, candidates: { orderBy: { rank: 'asc' }, include: { node: { select: { id: true, code: true, regionCode: true, status: true, allocatedUnits: true, capacityUnits: true } } } } },
    });
  }
}
