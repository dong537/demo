import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { createHash } from 'node:crypto';
import { prisma } from '@ipeasy/db';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext, requireOperatorContext } from '../../common/auth/auth-context';
import { RequireAuth } from '../../common/auth/guards';
import { ConfigService } from '../../common/config/config.service';
import { encryptAesGcm } from '../../common/crypto/aes-gcm';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { assertSafeUrl } from '../../common/utils/ssrf';
import { UpdateDedicatedLineLimitsUseCase } from './update-dedicated-line-limits.use-case';
import { ListDedicatedLineLimitsUseCase } from './list-dedicated-line-limits.use-case';
import { CreatePlacementPolicyUseCase } from './create-placement-policy.use-case';
import { LineDomainBindingsUseCase } from './line-domain-bindings.use-case';
import { PageQueryDto } from '../../common/pagination/pagination.dto';
import { DedicatedLineLimitPageDto, DedicatedLineLimitsResultDto, UpdateDedicatedLineLimitsDto } from './dedicated-line-lifecycle.dto';

@Controller('admin/control-plane')
@RequireAuth()
export class DedicatedLineControlPlaneAdminController {
  constructor(
    private readonly config: ConfigService,
    private readonly listLineLimits: ListDedicatedLineLimitsUseCase,
    private readonly updateLineLimits: UpdateDedicatedLineLimitsUseCase,
    private readonly createPlacementPolicy: CreatePlacementPolicyUseCase,
    private readonly lineDomains: LineDomainBindingsUseCase,
  ) {}

  @Get('nodes')
  async nodes(@CurrentContext() ctx: AuthenticatedContext) {
    requireOperatorContext(ctx);
    const rows = await prisma.control_nodes.findMany({ where: { siteId: ctx.siteId }, orderBy: { code: 'asc' } });
    return rows.map((row) => ({
      id: row.id, code: row.code, name: row.name, regionCode: row.regionCode, baseUrl: row.baseUrl, nodeGroupId: row.nodeGroupId,
      status: row.status, capacityUnits: row.capacityUnits, allocatedUnits: row.allocatedUnits, lastHealthyAt: row.lastHealthyAt,
    }));
  }

  @Get('references')
  async references(@CurrentContext() ctx: AuthenticatedContext) {
    requireOperatorContext(ctx);
    const [nodeGroups, inboundProfiles] = await Promise.all([
      prisma.node_groups.findMany({
        where: { siteId: ctx.siteId, isActive: true },
        select: { id: true, code: true, name: true, regionCode: true },
        orderBy: { code: 'asc' },
      }),
      prisma.inbound_profiles.findMany({
        where: { siteId: ctx.siteId, isActive: true },
        select: { id: true, nodeGroupId: true, code: true, protocol: true, inboundTag: true, listenPort: true },
        orderBy: { code: 'asc' },
      }),
    ]);
    return { nodeGroups, inboundProfiles };
  }

  @Post('nodes')
  async createNode(@CurrentContext() ctx: AuthenticatedContext, @Body() body: unknown) {
    requireOperatorContext(ctx);
    const value = object(body);
    const baseUrl = token(value['baseUrl'], 'control_node_base_url_required');
    assertSafeUrl(baseUrl);
    const credential = token(value['apiToken'], 'control_node_api_token_required');
    const nodeGroupId = token(value['nodeGroupId'], 'control_node_group_required');
    const capacityUnits = positiveInt(value['capacityUnits'], 'control_node_capacity_invalid');
    const group = await prisma.node_groups.findFirst({ where: { id: nodeGroupId, siteId: ctx.siteId } });
    if (!group) throw new AppError(ErrorCode.NOT_FOUND, 'control_node_group_not_found', 404);
    try {
      const row = await prisma.control_nodes.create({
        data: {
          siteId: ctx.siteId,
          tenantId: optionalToken(value['tenantId']),
          nodeGroupId,
          code: token(value['code'], 'control_node_code_required'),
          name: token(value['name'], 'control_node_name_required'),
          regionCode: token(value['regionCode'], 'control_node_region_required'),
          baseUrl,
          apiCredentialCiphertext: encryptAesGcm(credential, this.config.get('APP_ENCRYPTION_KEY')),
          apiCredentialFingerprint: createHash('sha256').update(credential).digest('hex'),
          status: status(value['status']),
          capacityUnits,
        },
      });
      return nodeSummary(row);
    } catch (error: unknown) {
      if (isUnique(error)) throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'control_node_code_or_credential_exists', 409);
      throw error;
    }
  }

  @Put('nodes/:id')
  async updateNode(@CurrentContext() ctx: AuthenticatedContext, @Param('id') id: string, @Body() body: unknown) {
    requireOperatorContext(ctx);
    const value = object(body);
    const existing = await prisma.control_nodes.findFirst({ where: { id, siteId: ctx.siteId } });
    if (!existing) throw new AppError(ErrorCode.NOT_FOUND, 'control_node_not_found', 404);
    const data: Record<string, unknown> = {};
    if (value['status'] !== undefined) data.status = status(value['status']);
    if (value['capacityUnits'] !== undefined) {
      const capacityUnits = positiveInt(value['capacityUnits'], 'control_node_capacity_invalid');
      if (capacityUnits < existing.allocatedUnits) throw new AppError(ErrorCode.VALIDATION_ERROR, 'control_node_capacity_below_allocated', 422);
      data.capacityUnits = capacityUnits;
    }
    if (value['apiToken'] !== undefined) {
      const credential = token(value['apiToken'], 'control_node_api_token_required');
      data.apiCredentialCiphertext = encryptAesGcm(credential, this.config.get('APP_ENCRYPTION_KEY'));
      data.apiCredentialFingerprint = createHash('sha256').update(credential).digest('hex');
    }
    if (Object.keys(data).length === 0) throw new AppError(ErrorCode.VALIDATION_ERROR, 'control_node_update_empty', 400);
    try {
      return nodeSummary(await prisma.control_nodes.update({ where: { id }, data: data as never }));
    } catch (error: unknown) {
      if (isUnique(error)) throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'control_node_credential_exists', 409);
      throw error;
    }
  }

  @Post('placement-policies')
  async createPolicy(@CurrentContext() ctx: AuthenticatedContext, @Body() body: unknown) {
    return this.createPlacementPolicy.execute(ctx, body);
  }

  @Get('placement-policies')
  async policies(@CurrentContext() ctx: AuthenticatedContext) {
    requireOperatorContext(ctx);
    return prisma.line_placement_policies.findMany({
      where: { siteId: ctx.siteId },
      include: { allowedNodes: { select: { nodeId: true, node: { select: { code: true } } } } },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  }

  @Put('lines/:id/domains')
  updateDomains(@CurrentContext() ctx: AuthenticatedContext, @Param('id') id: string, @Body() body: unknown) {
    return this.lineDomains.execute(ctx, id, body);
  }

  @Put('lines/:id/limits')
  @ApiOkResponse({ type: DedicatedLineLimitsResultDto })
  updateLimits(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
    @Body() body: UpdateDedicatedLineLimitsDto,
  ) {
    return this.updateLineLimits.execute(ctx, id, body);
  }

  @Get('lines')
  @ApiOkResponse({ type: DedicatedLineLimitPageDto })
  lines(@CurrentContext() ctx: AuthenticatedContext, @Query() query: PageQueryDto) {
    return this.listLineLimits.execute(ctx, query);
  }
}

function nodeSummary(row: { id: string; code: string; name: string; regionCode: string; baseUrl: string; nodeGroupId: string; status: string; capacityUnits: number; allocatedUnits: number; lastHealthyAt: Date | null }) {
  return { id: row.id, code: row.code, name: row.name, regionCode: row.regionCode, baseUrl: row.baseUrl, nodeGroupId: row.nodeGroupId, status: row.status, capacityUnits: row.capacityUnits, allocatedUnits: row.allocatedUnits, lastHealthyAt: row.lastHealthyAt };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError(ErrorCode.VALIDATION_ERROR, 'control_plane_body_invalid', 400);
  return value as Record<string, unknown>;
}

function token(value: unknown, reasonKey: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 256) throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400);
  return value.trim();
}

function optionalToken(value: unknown): string | null {
  return value === undefined || value === null || value === '' ? null : token(value, 'control_plane_token_invalid');
}

function positiveInt(value: unknown, reasonKey: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400);
  return value as number;
}

function status(value: unknown): 'ACTIVE' | 'DRAINING' | 'DISABLED' {
  if (value === undefined || value === 'ACTIVE') return 'ACTIVE';
  if (value === 'DRAINING' || value === 'DISABLED') return value;
  throw new AppError(ErrorCode.VALIDATION_ERROR, 'control_node_status_invalid', 400);
}

function isUnique(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'P2002');
}
