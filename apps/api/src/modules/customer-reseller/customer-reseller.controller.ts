import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { RequireUser } from '../../common/auth/guards';
import { ConfigService } from '../../common/config/config.service';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { isUniqueConstraintError } from '../../common/errors/prisma-errors';
import { requestIdStorage } from '../../common/logging/request-id.context';
import { PageQueryDto } from '../../common/pagination/pagination.dto';
import { AdjustWalletDto } from '../wallet/dto';
import { CustomerResellerRepository } from './customer-reseller.repository';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

type CreateCustomerBody = {
  email: string;
  password: string;
};

type CreateTemplateBody = {
  name: string;
  description?: string | null;
  isDefault?: boolean;
};

type RuleBody = {
  skuId: string;
  durationDays: number;
  unitPrice: string;
  currency: string;
  minQty?: number;
};

type RulesBody = RuleBody | { rules: RuleBody[] };

type ProductRuleBody = {
  skuId: string;
  enabled: boolean;
  unitPrice?: string;
  currency?: string;
};

type ProductsBody = ProductRuleBody | { products: ProductRuleBody[] };

@Controller('customer/reseller')
@RequireUser()
export class CustomerResellerController {
  constructor(
    private readonly repo: CustomerResellerRepository,
    private readonly config: ConfigService,
  ) {}

  @Get('me')
  me(@CurrentContext() ctx: AuthenticatedContext) {
    return this.repo.findOwnedTenant(ctx.siteId, ctx.ownerId);
  }

  @Get('overview')
  overview(@CurrentContext() ctx: AuthenticatedContext) {
    return this.repo.getOverview(ctx.siteId, ctx.ownerId);
  }

  @Get('users')
  async users(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: PageQueryDto,
  ) {
    const tenant = await this.repo.requireOwnedTenant(ctx.siteId, ctx.ownerId);
    return this.repo.listCustomers(ctx.siteId, tenant.id, query);
  }

  @Post('users')
  async createUser(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: CreateCustomerBody,
  ) {
    const tenant = await this.repo.requireOwnedTenant(ctx.siteId, ctx.ownerId);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!EMAIL_PATTERN.test(email)) throw new AppError(ErrorCode.VALIDATION_ERROR, 'invalid_email', 400);
    if (password.length < MIN_PASSWORD_LENGTH) throw new AppError(ErrorCode.VALIDATION_ERROR, 'password_too_weak', 400);
    return this.repo.createCustomer({
      siteId: ctx.siteId,
      tenantId: tenant.id,
      email,
      password,
      currency: this.config.get('APP_PLATFORM_CURRENCY'),
      actorUserId: ctx.ownerId,
      requestId: requestIdStorage.getStore() ?? ctx.requestId,
    }).catch((error: unknown) => {
      if (isUniqueConstraintError(error, 'email')) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'email_taken', 409);
      }
      throw error;
    });
  }

  @Post('users/:userId/wallet-adjust')
  async adjustUserWallet(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('userId') userId: string,
    @Body() body: AdjustWalletDto,
  ) {
    const tenant = await this.repo.requireOwnedTenant(ctx.siteId, ctx.ownerId);
    return this.repo.adjustCustomerWallet({
      siteId: ctx.siteId,
      tenantId: tenant.id,
      actorUserId: ctx.ownerId,
      targetUserId: userId,
      dto: body,
      requestId: requestIdStorage.getStore() ?? ctx.requestId,
    });
  }

  @Get('orders')
  async orders(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: PageQueryDto & { userId?: string; status?: string },
  ) {
    const tenant = await this.repo.requireOwnedTenant(ctx.siteId, ctx.ownerId);
    return this.repo.listOrders(ctx.siteId, tenant.id, query);
  }

  @Get('templates')
  async templates(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: PageQueryDto,
  ) {
    const tenant = await this.repo.requireOwnedTenant(ctx.siteId, ctx.ownerId);
    return this.repo.listTemplates(ctx.siteId, tenant.id, query);
  }

  @Get('products')
  async products(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: PageQueryDto & { search?: string; status?: string },
  ) {
    const tenant = await this.repo.requireOwnedTenant(ctx.siteId, ctx.ownerId);
    return this.repo.listProducts(ctx.siteId, tenant.id, query);
  }

  @Post('products')
  async saveProducts(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: ProductsBody,
  ) {
    const tenant = await this.repo.requireOwnedTenant(ctx.siteId, ctx.ownerId);
    const products = normalizeProductsBody(body);
    return this.repo.upsertProductRules(ctx.siteId, tenant.id, products);
  }

  @Post('templates')
  async createTemplate(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: CreateTemplateBody,
  ) {
    const tenant = await this.repo.requireOwnedTenant(ctx.siteId, ctx.ownerId);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw new AppError(ErrorCode.VALIDATION_ERROR, 'template_name_required', 400);
    return this.repo.createTemplate(ctx.siteId, tenant.id, {
      name,
      description: body.description ?? null,
      isDefault: body.isDefault ?? false,
    });
  }

  @Post('templates/:id/rules')
  async rules(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') templateId: string,
    @Body() body: RulesBody,
  ) {
    const tenant = await this.repo.requireOwnedTenant(ctx.siteId, ctx.ownerId);
    const rules = normalizeRulesBody(body);
    return this.repo.upsertRules(ctx.siteId, tenant.id, templateId, rules);
  }
}

function normalizeProductsBody(body: ProductsBody): Array<{ skuId: string; enabled: boolean; unitPrice?: string; currency?: string }> {
  const products = 'products' in body ? body.products : [body];
  if (!Array.isArray(products) || products.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'products_required', 400);
  }
  return products.map((product) => {
    if (!product.skuId) throw new AppError(ErrorCode.VALIDATION_ERROR, 'sku_id_required', 400);
    if (typeof product.enabled !== 'boolean') throw new AppError(ErrorCode.VALIDATION_ERROR, 'enabled_invalid', 400);
    if (product.enabled && !isNonNegativeDecimalString(product.unitPrice)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'unit_price_invalid', 400);
    }
    if (product.enabled && !product.currency) throw new AppError(ErrorCode.VALIDATION_ERROR, 'currency_required', 400);
    return {
      skuId: product.skuId,
      enabled: product.enabled,
      unitPrice: product.unitPrice === undefined ? undefined : String(product.unitPrice),
      currency: product.currency,
    };
  });
}

function normalizeRulesBody(body: RulesBody): RuleBody[] {
  const rules = 'rules' in body ? body.rules : [body];
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'price_rules_required', 400);
  }
  return rules.map((rule) => {
    if (!rule.skuId) throw new AppError(ErrorCode.VALIDATION_ERROR, 'sku_id_required', 400);
    const durationDays = Number(rule.durationDays);
    if (!Number.isInteger(durationDays) || durationDays < 1) throw new AppError(ErrorCode.VALIDATION_ERROR, 'duration_days_invalid', 400);
    if (!isNonNegativeDecimalString(rule.unitPrice)) throw new AppError(ErrorCode.VALIDATION_ERROR, 'unit_price_invalid', 400);
    if (!rule.currency) throw new AppError(ErrorCode.VALIDATION_ERROR, 'currency_required', 400);
    const minQty = rule.minQty === undefined ? undefined : Number(rule.minQty);
    if (minQty !== undefined && (!Number.isInteger(minQty) || minQty < 1)) throw new AppError(ErrorCode.VALIDATION_ERROR, 'min_qty_invalid', 400);
    return {
      skuId: rule.skuId,
      durationDays,
      unitPrice: String(rule.unitPrice),
      currency: rule.currency,
      ...(minQty === undefined ? {} : { minQty }),
    };
  });
}

function isNonNegativeDecimalString(value: unknown): value is string | number {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  return /^\d+(\.\d+)?$/.test(String(value));
}
