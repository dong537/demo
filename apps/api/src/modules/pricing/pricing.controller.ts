import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { RequireAuth, RequireUser } from '../../common/auth/guards';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PageQueryDto } from '../../common/pagination/pagination.dto';
import { PricingMatrixQuery, PricingMatrixSummaryQuery, PricingRepository } from './pricing.repository';
import { QuoteInput } from './domain';
import { QuoteUseCase } from './use-cases/quote.use-case';
import { ResourcesRepository } from '../resources/resources.repository';
import { assertStaticProxyPurchaseDisabled } from '../orders/static-purchase-disabled';

type CreateTemplateBody = {
  name: string;
  description?: string | null;
  isDefault?: boolean;
};

type PriceRuleBody = {
  resourceId: string;
  durationDays: number;
  unitPrice: string;
  currency: string;
  minQty?: number;
};

type PriceRulesBody = PriceRuleBody | { rules: PriceRuleBody[] };

type PriceOverrideBody = {
  resourceId: string;
  durationDays: number;
  unitPrice: string;
  currency: string;
};

type PriceableCatalogGroupOverrideBody = {
  countryCode: string;
  regionKey?: string;
  costGroupKey?: string;
  autoSelect?: boolean;
  providerCode?: string;
  durationDays: number;
  unitPrice: string;
  currency: string;
};

type UserPriceOverrideBody = PriceOverrideBody & {
  tenantId: string;
  userId: string;
};

type UserTemplateBindingBody = {
  tenantId: string;
  userId: string;
  templateId: string;
};

type DedicatedSkuPriceBody = {
  skuId: string;
  durationDays: number;
  minQty?: number;
  unitPrice: string;
  currency: string;
};

type DedicatedSkuUserPriceBody = DedicatedSkuPriceBody & {
  tenantId: string;
  userId: string;
};

type QuoteSandboxBody = Omit<QuoteInput, 'siteId'> & {
  siteId?: string;
};

@Controller('pricing')
export class PricingController {
  constructor(
    private readonly repo: PricingRepository,
    private readonly resourcesRepo: ResourcesRepository,
    private readonly quoteUseCase: QuoteUseCase,
  ) {}

  @Get('templates')
  @RequireAuth()
  listTemplates(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: PageQueryDto,
  ) {
    assertAdmin(ctx);
    return this.repo.listTemplates(ctx.siteId, query);
  }

  @Post('templates')
  @RequireAuth()
  createTemplate(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: CreateTemplateBody,
  ) {
    assertAdmin(ctx);
    if (!body.name?.trim()) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'template_name_required', 400);
    }
    return this.repo.createTemplate({
      siteId: ctx.siteId,
      name: body.name.trim(),
      description: body.description ?? null,
      isDefault: body.isDefault ?? false,
    });
  }

  @Post('templates/:id/rules')
  @RequireAuth()
  createRules(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') templateId: string,
    @Body() body: PriceRulesBody,
  ) {
    assertAdmin(ctx);
    const rules = normalizeRulesBody(body);
    return this.repo.upsertRules(templateId, ctx.siteId, rules);
  }

  @Get('dedicated-skus')
  @RequireAuth()
  listDedicatedSkuPricing(@CurrentContext() ctx: AuthenticatedContext) {
    assertPlatformAdmin(ctx);
    return this.repo.listDedicatedSkuPricing(ctx.siteId);
  }

  @Post('dedicated-skus/template-rules')
  @RequireAuth()
  upsertDedicatedSkuTemplateRule(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: DedicatedSkuPriceBody & { templateId: string },
  ) {
    assertPlatformAdmin(ctx);
    const normalized = normalizeDedicatedSkuPriceBody(body);
    if (!body.templateId) throw new AppError(ErrorCode.VALIDATION_ERROR, 'price_template_required', 400);
    return this.repo.upsertDedicatedSkuTemplateRule({ ...normalized, templateId: body.templateId, siteId: ctx.siteId });
  }

  @Post('dedicated-skus/overrides')
  @RequireAuth()
  upsertDedicatedSkuOverride(@CurrentContext() ctx: AuthenticatedContext, @Body() body: DedicatedSkuPriceBody) {
    assertPlatformAdmin(ctx);
    return this.repo.upsertDedicatedSkuOverride({ ...normalizeDedicatedSkuPriceBody(body), siteId: ctx.siteId });
  }

  @Post('dedicated-skus/user-overrides')
  @RequireAuth()
  upsertUserDedicatedSkuOverride(@CurrentContext() ctx: AuthenticatedContext, @Body() body: DedicatedSkuUserPriceBody) {
    assertAdmin(ctx);
    if (!body.tenantId || !body.userId) throw new AppError(ErrorCode.VALIDATION_ERROR, 'user_price_target_required', 400);
    assertTenantWriteAllowed(ctx, body.tenantId);
    return this.repo.upsertUserDedicatedSkuOverride({
      ...normalizeDedicatedSkuPriceBody(body),
      siteId: ctx.siteId,
      tenantId: body.tenantId,
      userId: body.userId,
    });
  }

  @Get('matrix')
  @RequireAuth()
  listMatrix(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: PricingMatrixQuery,
  ) {
    assertAdmin(ctx);
    return this.repo.listMatrix(ctx.siteId, { ...query, tenantId: ctx.tenantId ?? null });
  }

  @Get('matrix/summary')
  @RequireAuth()
  listMatrixSummary(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: PricingMatrixSummaryQuery,
  ) {
    assertAdmin(ctx);
    return this.repo.listMatrixSummary(ctx.siteId, { ...query, tenantId: ctx.tenantId ?? null });
  }

  @Post('overrides')
  @RequireAuth()
  createOverride(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: PriceOverrideBody,
  ) {
    assertAdmin(ctx);
    assertPriceBody(body);
    return this.repo.upsertOverride({ ...body, siteId: ctx.siteId });
  }

  @Post('resource-group-overrides')
  @RequireAuth()
  async createResourceGroupOverride(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: PriceableCatalogGroupOverrideBody,
  ) {
    assertAdmin(ctx);
    assertGroupPriceBody(body);
    const resourceIds = await this.resourcesRepo.findPriceableCatalogGroupResourceIds(ctx.siteId, {
      countryCode: body.countryCode,
      regionKey: body.regionKey,
      costGroupKey: body.costGroupKey,
      autoSelect: body.autoSelect,
      providerCode: body.providerCode,
      tenantId: ctx.tenantId ?? null,
      durationDays: body.durationDays,
      currency: body.currency,
    });
    return this.repo.replaceOverridesForResources({
      siteId: ctx.siteId,
      resourceIds,
      durationDays: Number(body.durationDays),
      unitPrice: String(body.unitPrice),
      currency: body.currency,
    });
  }

  @Post('user-overrides')
  @RequireAuth()
  createUserOverride(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: UserPriceOverrideBody,
  ) {
    assertAdmin(ctx);
    assertPriceBody(body);
    if (!body.tenantId || !body.userId) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'user_price_target_required', 400);
    }
    assertTenantWriteAllowed(ctx, body.tenantId);
    return this.repo.upsertUserOverride({ ...body, siteId: ctx.siteId });
  }

  @Post('user-template-bindings')
  @RequireAuth()
  bindUserTemplate(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: UserTemplateBindingBody,
  ) {
    assertAdmin(ctx);
    if (!body.tenantId || !body.userId || !body.templateId) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'user_template_binding_required', 400);
    }
    assertTenantWriteAllowed(ctx, body.tenantId);
    return this.repo.bindUserTemplate({ ...body, siteId: ctx.siteId });
  }

  @Post('quote-sandbox')
  @RequireAuth()
  quoteSandbox(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: QuoteSandboxBody,
  ) {
    assertAdmin(ctx);
    if (!body.tenantId) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'tenant_id_required', 400);
    }
    assertTenantWriteAllowed(ctx, body.tenantId);
    return this.quoteUseCase.execute({
      ...body,
      siteId: ctx.siteId,
      durationDays: Number(body.durationDays),
      quantity: Number(body.quantity),
    });
  }

  @Get('quote')
  @RequireUser()
  quote(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query('resourceId') resourceId: string,
    @Query('durationDays') durationDays: string,
    @Query('quantity') quantity: string,
    @Query('currency') currency: string,
  ) {
    assertStaticProxyPurchaseDisabled();
    return this.quoteUseCase.execute({
      siteId: ctx.siteId,
      tenantId: ctx.tenantId!,
      userId: ctx.ownerId,
      resourceId,
      durationDays: Number(durationDays),
      quantity: quantity ? Number(quantity) : 1,
      currency,
    });
  }
}

function assertAdmin(ctx: AuthenticatedContext): void {
  if (ctx.ownerType !== 'PLATFORM_ADMIN' && ctx.ownerType !== 'TENANT_ADMIN') {
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
  }
}

function assertTenantWriteAllowed(ctx: AuthenticatedContext, tenantId: string): void {
  if (ctx.ownerType === 'TENANT_ADMIN' && ctx.tenantId !== tenantId) {
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
  }
}

function normalizeRulesBody(body: PriceRulesBody): PriceRuleBody[] {
  const rules = 'rules' in body ? body.rules : [body];
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'price_rules_required', 400);
  }
  return rules.map((rule) => {
    assertPriceBody(rule);
    return {
      ...rule,
      durationDays: Number(rule.durationDays),
      unitPrice: String(rule.unitPrice),
      minQty: rule.minQty === undefined ? undefined : Number(rule.minQty),
    };
  });
}

function assertPriceBody(body: PriceOverrideBody): void {
  if (!body.resourceId) throw new AppError(ErrorCode.VALIDATION_ERROR, 'resource_id_required', 400);
  if (!Number.isInteger(Number(body.durationDays)) || Number(body.durationDays) < 1) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'duration_days_invalid', 400);
  }
  if (!isNonNegativeDecimalString(body.unitPrice)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'unit_price_invalid', 400);
  }
  if (!body.currency) throw new AppError(ErrorCode.VALIDATION_ERROR, 'currency_required', 400);
  if (hasMinQty(body) && body.minQty !== undefined && (!Number.isInteger(Number(body.minQty)) || Number(body.minQty) < 1)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'min_qty_invalid', 400);
  }
}

function assertPlatformAdmin(ctx: AuthenticatedContext): void {
  if (ctx.ownerType !== 'PLATFORM_ADMIN') {
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
  }
}

function normalizeDedicatedSkuPriceBody(body: DedicatedSkuPriceBody) {
  const durationDays = Number(body.durationDays);
  const minQty = body.minQty === undefined ? 1 : Number(body.minQty);
  if (!body.skuId) throw new AppError(ErrorCode.VALIDATION_ERROR, 'sku_id_required', 400);
  if (!Number.isInteger(durationDays) || durationDays < 1) throw new AppError(ErrorCode.VALIDATION_ERROR, 'duration_days_invalid', 400);
  if (!Number.isInteger(minQty) || minQty < 1) throw new AppError(ErrorCode.VALIDATION_ERROR, 'min_qty_invalid', 400);
  if (!isNonNegativeDecimalString(body.unitPrice)) throw new AppError(ErrorCode.VALIDATION_ERROR, 'unit_price_invalid', 400);
  if (!body.currency?.trim()) throw new AppError(ErrorCode.VALIDATION_ERROR, 'currency_required', 400);
  return { skuId: body.skuId, durationDays, minQty, unitPrice: String(body.unitPrice), currency: body.currency.trim() };
}

function assertGroupPriceBody(body: PriceableCatalogGroupOverrideBody): void {
  if (!body.countryCode?.trim()) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'country_code_required', 400);
  }
  if (!/^[A-Za-z]{2}$/.test(body.countryCode.trim())) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'country_code_invalid', 400);
  }
  if (!body.autoSelect && (!body.regionKey?.trim() || !body.costGroupKey?.trim())) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'resource_group_required', 400);
  }
  if (body.providerCode && !['IPIPD', 'NINE_EIGHT_FIVE', 'PR', 'UPSTREAM_API'].includes(body.providerCode)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'provider_code_invalid', 400);
  }
  if (!Number.isInteger(Number(body.durationDays)) || Number(body.durationDays) < 1) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'duration_days_invalid', 400);
  }
  if (!isNonNegativeDecimalString(body.unitPrice)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'unit_price_invalid', 400);
  }
  if (!body.currency) throw new AppError(ErrorCode.VALIDATION_ERROR, 'currency_required', 400);
}

function isNonNegativeDecimalString(value: unknown): value is string {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const text = String(value);
  return /^\d+(\.\d+)?$/.test(text);
}

function hasMinQty(value: PriceOverrideBody): value is PriceOverrideBody & { minQty?: unknown } {
  return 'minQty' in value;
}
