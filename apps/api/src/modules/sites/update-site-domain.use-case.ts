import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { isUniqueConstraintError } from '../../common/errors/prisma-errors';
import { requestIdStorage } from '../../common/logging/request-id.context';
import { normalizeDnsHostname } from '../../common/validation/dns-hostname';

@Injectable()
export class UpdateSiteDomainUseCase {
  async execute(ctx: AuthenticatedContext, input: unknown) {
    if (ctx.ownerType !== 'PLATFORM_ADMIN' && ctx.ownerType !== 'SYSTEM') {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'site_domain_admin_required', 403);
    }

    const domain = normalizeDnsHostname(readDomain(input), 'site_domain_invalid');
    const requestId = requestIdStorage.getStore() ?? ctx.requestId;

    try {
      return await prisma.$transaction(async (tx) => {
        const site = await tx.sites.findUnique({
          where: { id: ctx.siteId },
          select: { id: true, domain: true },
        });
        if (!site) throw new AppError(ErrorCode.NOT_FOUND, 'site_not_found', 404);

        const tenantUsingDomain = await tx.tenants.findFirst({
          where: { brandConfig: { path: ['customDomain'], equals: domain } },
          select: { id: true },
        });
        if (tenantUsingDomain) {
          throw new AppError(ErrorCode.VALIDATION_ERROR, 'site_domain_taken', 409);
        }

        const updated = await tx.sites.update({
          where: { id: site.id },
          data: { domain },
        });
        await tx.audit_logs.create({
          data: {
            siteId: site.id,
            tenantId: null,
            actorType: ctx.ownerType === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_USER',
            actorId: ctx.ownerId,
            targetType: 'site',
            targetId: site.id,
            action: 'site.domain.update',
            requestId,
            meta: { previousDomain: site.domain, newDomain: domain },
          },
        });

        return updated;
      });
    } catch (error) {
      if (isUniqueConstraintError(error, 'domain')) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'site_domain_taken', 409);
      }
      throw error;
    }
  }
}

function readDomain(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'invalid_request', 400);
  }
  return (input as Record<string, unknown>)['domain'];
}
