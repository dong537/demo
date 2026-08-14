import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { Prisma } from '@ipeasy/db/generated/client';
import { AuthenticatedContext, requireOperatorContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { normalizeDnsHostname } from '../../common/validation/dns-hostname';

type DomainInput = { hostname: string; port: number; role: 'PRIMARY' | 'BACKUP' };

@Injectable()
export class LineDomainBindingsUseCase {
  async execute(ctx: AuthenticatedContext, lineId: string, body: unknown) {
    requireOperatorContext(ctx);
    const input = normalizeInput(body);
    return prisma.$transaction(async (tx) => {
      const line = await tx.dedicated_lines.findFirst({
        where: { id: lineId, siteId: ctx.siteId },
        select: { id: true, tenantId: true, userId: true },
      });
      if (!line) throw new AppError(ErrorCode.NOT_FOUND, 'dedicated_line_not_found', 404);

      const existing = await tx.dedicated_line_domain_binding_operations.findUnique({
        where: { siteId_dedicatedLineId_idempotencyKey: { siteId: ctx.siteId, dedicatedLineId: line.id, idempotencyKey: input.idempotencyKey } },
        select: { result: true },
      });
      if (existing) return existing.result;

      const active = await tx.dedicated_line_domains.findMany({
        where: { siteId: ctx.siteId, dedicatedLineId: line.id, status: 'ACTIVE' },
        select: { hostname: true, port: true, role: true },
      });
      const result = {
        lineId: line.id,
        domains: input.domains,
        previousDomains: active,
        changed: !sameDomains(active, input.domains),
      };
      if (sameDomains(active, input.domains)) {
        await tx.dedicated_line_domain_binding_operations.create({
          data: { siteId: ctx.siteId, tenantId: line.tenantId, userId: line.userId, dedicatedLineId: line.id, idempotencyKey: input.idempotencyKey, result },
        });
        return result;
      }
      await tx.dedicated_line_domains.updateMany({
        where: { siteId: ctx.siteId, dedicatedLineId: line.id, status: 'ACTIVE' },
        data: { status: 'RETIRED', retiredAt: new Date(), retiredReason: input.reason },
      });
      await tx.dedicated_line_domains.createMany({
        data: input.domains.map((domain) => ({ ...domain, siteId: ctx.siteId, dedicatedLineId: line.id })),
      });
      await tx.audit_logs.create({
        data: {
          siteId: ctx.siteId, tenantId: line.tenantId, actorType: ctx.ownerType === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_USER', actorId: ctx.ownerId,
          targetType: 'dedicated_line_domains', targetId: line.id, action: 'dedicated_line.domains.replace', reason: input.reason,
          requestId: ctx.requestId, meta: { domains: input.domains, previousDomains: active },
        },
      });
      await tx.dedicated_line_domain_binding_operations.create({
        data: { siteId: ctx.siteId, tenantId: line.tenantId, userId: line.userId, dedicatedLineId: line.id, idempotencyKey: input.idempotencyKey, result },
      });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

function normalizeInput(body: unknown): { domains: DomainInput[]; reason: string; idempotencyKey: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError(ErrorCode.VALIDATION_ERROR, 'line_domains_body_invalid', 400);
  const value = body as Record<string, unknown>;
  const domains = value.domains;
  if (!Array.isArray(domains) || domains.length < 1 || domains.length > 32) throw new AppError(ErrorCode.VALIDATION_ERROR, 'line_domains_invalid', 400);
  const normalized = domains.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AppError(ErrorCode.VALIDATION_ERROR, 'line_domain_invalid', 400);
    const item = raw as Record<string, unknown>;
    const hostname = normalizeDnsHostname(item.hostname, 'line_domain_hostname_invalid');
    if (!Number.isInteger(item.port) || Number(item.port) < 1 || Number(item.port) > 65_535) throw new AppError(ErrorCode.VALIDATION_ERROR, 'line_domain_port_invalid', 400);
    if (item.role !== 'PRIMARY' && item.role !== 'BACKUP') throw new AppError(ErrorCode.VALIDATION_ERROR, 'line_domain_role_invalid', 400);
    return { hostname, port: Number(item.port), role: item.role } as DomainInput;
  });
  if (normalized.filter((domain) => domain.role === 'PRIMARY').length !== 1) throw new AppError(ErrorCode.VALIDATION_ERROR, 'line_primary_domain_required', 422);
  if (!normalized.some((domain) => domain.role === 'BACKUP')) throw new AppError(ErrorCode.VALIDATION_ERROR, 'line_backup_domain_required', 422);
  if (new Set(normalized.map((domain) => `${domain.hostname}:${domain.port}`)).size !== normalized.length) throw new AppError(ErrorCode.VALIDATION_ERROR, 'line_domain_duplicate', 422);
  return { domains: normalized, reason: token(value.reason, 'line_domain_reason_required'), idempotencyKey: token(value.idempotencyKey, 'line_domain_idempotency_required') };
}

function token(value: unknown, reasonKey: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 256) throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400);
  return value.trim();
}

function sameDomains(left: Array<{ hostname: string; port: number; role: string }>, right: DomainInput[]): boolean {
  const normalize = (domains: Array<{ hostname: string; port: number; role: string }>) => domains.map((domain) => `${domain.hostname}:${domain.port}:${domain.role}`).sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}
