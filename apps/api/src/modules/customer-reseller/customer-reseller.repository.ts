import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { prisma, Prisma } from '@ipeasy/db';
import Decimal from 'decimal.js';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PageQueryDto, PageResult, normalizePageQuery } from '../../common/pagination/pagination.dto';
import { requestIdStorage } from '../../common/logging/request-id.context';
import { WalletRepository } from '../wallet/wallet.repository';
import { AdjustWalletDto, WalletDto } from '../wallet/dto';
import { assertPositiveAmount, assertSameCurrency } from '../wallet/domain';

const BCRYPT_COST = 10;
type PrismaTransactionClient = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export type OwnedTenant = {
  id: string;
  siteId: string;
  ownerUserId: string | null;
  code: string;
  name: string;
  status: string;
  customerCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ResellerCustomer = {
  id: string;
  email: string;
  tenantId: string;
  status: string;
  available: string;
  frozen: string;
  currency: string;
  orderCount: number;
  createdAt: Date;
};

export type ResellerProduct = {
  skuId: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
  availableInventory: number | null;
  inventoryCapturedAt: Date | null;
  inventoryIsStale: boolean;
  enabled: boolean;
  unitPrice: string | null;
  currency: string | null;
};

@Injectable()
export class CustomerResellerRepository {
  constructor(private readonly walletRepo: WalletRepository) {}

  async findOwnedTenant(siteId: string, ownerUserId: string): Promise<OwnedTenant | null> {
    const tenant = await prisma.tenants.findFirst({
      where: { siteId, ownerUserId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { users: true } } },
    });
    if (!tenant) return null;
    return {
      id: tenant.id,
      siteId: tenant.siteId,
      ownerUserId: tenant.ownerUserId,
      code: tenant.code,
      name: tenant.name,
      status: tenant.status,
      customerCount: tenant._count.users,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
    };
  }

  async requireOwnedTenant(siteId: string, ownerUserId: string): Promise<OwnedTenant> {
    const tenant = await this.findOwnedTenant(siteId, ownerUserId);
    if (!tenant) throw new AppError(ErrorCode.NOT_FOUND, 'reseller_not_created', 404);
    return tenant;
  }

  async getOverview(siteId: string, ownerUserId: string) {
    const tenant = await this.requireOwnedTenant(siteId, ownerUserId);
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const [customerCount, orderCount, monthlyOrders, templateCount, productCount, saleableProductCount, wallets] = await Promise.all([
      prisma.users.count({ where: { siteId, tenantId: tenant.id } }),
      prisma.dedicated_line_orders.count({ where: { siteId, tenantId: tenant.id } }),
      prisma.dedicated_line_orders.count({ where: { siteId, tenantId: tenant.id, createdAt: { gte: monthStart } } }),
      prisma.price_templates.count({ where: { siteId, tenantId: tenant.id } }),
      prisma.service_skus.count({ where: dedicatedLineSkuWhere(siteId) }),
      this.countTenantProducts(siteId, tenant.id),
      prisma.wallets.findMany({ where: { siteId, tenantId: tenant.id }, select: { available: true, currency: true } }),
    ]);
    const balanceByCurrency: Record<string, string> = {};
    for (const wallet of wallets) {
      const current = new Decimal(balanceByCurrency[wallet.currency] ?? '0');
      balanceByCurrency[wallet.currency] = current.plus(wallet.available.toString()).toFixed();
    }
    return { tenant, stats: { customerCount, orderCount, monthlyOrders, templateCount, productCount, saleableProductCount, balanceByCurrency } };
  }

  async listProducts(siteId: string, tenantId: string, query: PageQueryDto & { search?: string; status?: string } = {}): Promise<PageResult<ResellerProduct>> {
    const { page, pageSize } = normalizePageQuery(query);
    const where = dedicatedLineSkuWhere(siteId);
    const template = await this.findDefaultTemplate(siteId, tenantId);
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.status === 'ENABLED') {
      if (!template) return { page, pageSize, total: 0, items: [] };
      const enabledRules = await prisma.sku_price_rules.findMany({
        where: { siteId, templateId: template.id, durationDays: 30 },
        select: { skuId: true },
      });
      where.id = { in: enabledRules.map((rule) => rule.skuId) };
    }
    if (query.status === 'DISABLED' && template) {
      const enabledRules = await prisma.sku_price_rules.findMany({
        where: { siteId, templateId: template.id, durationDays: 30 },
        select: { skuId: true },
      });
      where.id = { notIn: enabledRules.map((rule) => rule.skuId) };
    }

    const [total, rows] = await Promise.all([
      prisma.service_skus.count({ where }),
      prisma.service_skus.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          skuPriceRules: {
            where: { siteId, templateId: template?.id ?? '', durationDays: 30, minQty: { lte: 1 } },
            orderBy: { minQty: 'desc' },
            take: 1,
          },
        },
      }),
    ]);
    const inventoryBySku = await this.summarizeSkuInventory(siteId, rows.map((row) => row.id));
    return { page, pageSize, total, items: rows.map((row) => toResellerProduct(row, inventoryBySku.get(row.id))) };
  }

  async upsertProductRules(siteId: string, tenantId: string, products: Array<{
    skuId: string;
    enabled: boolean;
    unitPrice?: string;
    currency?: string;
  }>) {
    const template = await this.ensureDefaultTemplate(siteId, tenantId);
    const skuIds = [...new Set(products.map((product) => product.skuId))];
    const skuCount = await prisma.service_skus.count({
      where: { ...dedicatedLineSkuWhere(siteId), id: { in: skuIds } },
    });
    if (skuCount !== skuIds.length) {
      throw new AppError(ErrorCode.NOT_FOUND, 'sku_not_found', 404);
    }
    return prisma.$transaction(products.map((product) => {
      if (!product.enabled) {
        return prisma.sku_price_rules.deleteMany({
          where: { siteId, templateId: template.id, skuId: product.skuId, durationDays: 30 },
        });
      }
      return prisma.sku_price_rules.upsert({
        where: {
          siteId_templateId_skuId_durationDays_minQty: {
            siteId,
            templateId: template.id,
            skuId: product.skuId,
            durationDays: 30,
            minQty: 1,
          },
        },
        create: {
          siteId,
          templateId: template.id,
          skuId: product.skuId,
          durationDays: 30,
          unitPrice: product.unitPrice!,
          currency: product.currency!,
          minQty: 1,
        },
        update: {
          unitPrice: product.unitPrice!,
          currency: product.currency!,
          minQty: 1,
        },
      });
    }));
  }

  async listCustomers(siteId: string, tenantId: string, query: PageQueryDto = {}): Promise<PageResult<ResellerCustomer>> {
    const { page, pageSize } = normalizePageQuery(query);
    const where: Prisma.usersWhereInput = { siteId, tenantId };
    if (query.search) where.email = { contains: query.search, mode: 'insensitive' };
    const [total, rows] = await Promise.all([
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
          createdAt: true,
          wallets: { take: 1, select: { available: true, frozen: true, currency: true } },
          _count: { select: { dedicated_line_orders: true } },
        },
      }),
    ]);
    return {
      page,
      pageSize,
      total,
      items: rows.map((row) => {
        const wallet = row.wallets[0];
        return {
          id: row.id,
          email: row.email,
          tenantId: row.tenantId,
          status: row.status,
          available: wallet?.available.toString() ?? '0',
          frozen: wallet?.frozen.toString() ?? '0',
          currency: wallet?.currency ?? '',
          orderCount: row._count.dedicated_line_orders,
          createdAt: row.createdAt,
        };
      }),
    };
  }

  async createCustomer(input: {
    siteId: string;
    tenantId: string;
    email: string;
    password: string;
    currency: string;
    actorUserId: string;
    requestId: string;
  }): Promise<{ id: string; email: string; tenantId: string }> {
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
    return prisma.$transaction(async (tx) => {
      const user = await tx.users.create({
        data: {
          siteId: input.siteId,
          tenantId: input.tenantId,
          email: input.email,
          passwordHash,
          status: 'ACTIVE',
          kycStatus: 'NONE',
          riskStatus: 'NORMAL',
        },
        select: { id: true, email: true, tenantId: true },
      });
      await tx.wallets.create({
        data: {
          siteId: input.siteId,
          tenantId: input.tenantId,
          userId: user.id,
          available: '0',
          frozen: '0',
          currency: input.currency,
        },
      });
      await tx.audit_logs.create({
        data: {
          siteId: input.siteId,
          tenantId: input.tenantId,
          actorType: 'USER',
          actorId: input.actorUserId,
          targetType: 'user',
          targetId: user.id,
          action: 'reseller.user.create',
          requestId: input.requestId,
        },
      });
      return user;
    });
  }

  async adjustCustomerWallet(input: {
    siteId: string;
    tenantId: string;
    actorUserId: string;
    targetUserId: string;
    dto: AdjustWalletDto;
    requestId?: string;
  }): Promise<WalletDto> {
    const direction = input.dto.direction;
    if (direction !== 'credit' && direction !== 'debit') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'wallet_adjust_direction_invalid', 400);
    }
    assertPositiveAmount(input.dto.amount);
    const reason = typeof input.dto.reason === 'string' ? input.dto.reason.trim() : '';
    if (!reason) throw new AppError(ErrorCode.VALIDATION_ERROR, 'reason_required', 400);
    if (!input.dto.idempotencyKey) throw new AppError(ErrorCode.VALIDATION_ERROR, 'idempotency_key_required', 400);

    const wallet = await this.walletRepo.getWalletByUserId(input.targetUserId, input.siteId, input.tenantId);
    assertSameCurrency(wallet.currency, input.dto.currency);

    const updatedWallet = await prisma.$transaction(async (tx) => {
      const txClient = tx as PrismaTransactionClient;
      if (direction === 'credit') {
        await this.walletRepo.creditWalletTx(
          txClient,
          wallet.id,
          input.dto.amount,
          input.dto.currency,
          'ADJUSTMENT',
          input.actorUserId,
          reason,
          input.dto.idempotencyKey,
        );
      } else {
        await this.walletRepo.debitWalletTx(
          txClient,
          wallet.id,
          input.dto.amount,
          input.dto.currency,
          'ADJUSTMENT',
          input.actorUserId,
          reason,
          input.dto.idempotencyKey,
        );
      }

      await tx.audit_logs.create({
        data: {
          siteId: input.siteId,
          tenantId: input.tenantId,
          actorType: 'USER',
          actorId: input.actorUserId,
          targetType: 'wallet',
          targetId: wallet.id,
          action: 'reseller.wallet.adjust',
          reason,
          requestId: input.requestId ?? requestIdStorage.getStore() ?? '',
          meta: {
            targetUserId: input.targetUserId,
            amount: input.dto.amount,
            direction,
            idempotencyKey: input.dto.idempotencyKey,
          },
        },
      });

      return tx.wallets.findUniqueOrThrow({ where: { id: wallet.id } });
    });

    return {
      id: updatedWallet.id,
      userId: updatedWallet.userId,
      available: updatedWallet.available.toString(),
      frozen: updatedWallet.frozen.toString(),
      currency: updatedWallet.currency,
      updatedAt: updatedWallet.updatedAt,
    };
  }

  async listOrders(siteId: string, tenantId: string, query: PageQueryDto & { userId?: string; status?: string } = {}) {
    const { page, pageSize } = normalizePageQuery(query);
    const where: Prisma.dedicated_line_ordersWhereInput = { siteId, tenantId };
    if (query.userId) where.userId = query.userId;
    if (query.status) {
      if (!isExternalJobStatus(query.status)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'dedicated_line_order_status_invalid', 400);
      }
      where.executionJob = { is: { kind: 'PROVIDER_DEDICATED_LINE_ORDER', status: query.status } };
    }
    const [total, rows] = await Promise.all([
      prisma.dedicated_line_orders.count({ where }),
      prisma.dedicated_line_orders.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { email: true } },
          executionJob: {
            select: { status: true, attempt: true, maxAttempts: true, lastErrorCode: true, createdAt: true, updatedAt: true },
          },
          lines: { select: { status: true } },
        },
      }),
    ]);
    const items = rows.map((row) => {
      if (!row.executionJob) {
        throw new AppError(ErrorCode.INTERNAL_ERROR, 'dedicated_line_order_execution_missing', 500);
      }
      const lineStatuses: Record<string, number> = {};
      for (const line of row.lines) lineStatuses[line.status] = (lineStatuses[line.status] ?? 0) + 1;
      return {
        id: row.id,
        userId: row.userId,
        user: row.user,
        sku: { code: row.skuCode, name: row.skuName },
        countryCode: row.countryCode,
        regionCode: row.regionCode,
        businessType: row.businessType,
        quantity: row.quantity,
        durationDays: row.durationDays,
        unitPrice: row.unitPrice.toString(),
        totalPrice: row.totalPrice.toString(),
        currency: row.currency,
        priceSource: row.priceSource,
        contractVersion: row.contractVersion,
        execution: {
          status: row.executionJob.status,
          attempt: row.executionJob.attempt,
          maxAttempts: row.executionJob.maxAttempts,
          lastErrorCode: row.executionJob.lastErrorCode,
          createdAt: row.executionJob.createdAt,
          updatedAt: row.executionJob.updatedAt,
        },
        lineStatuses,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
    return { page, pageSize, total, items };
  }

  async listTemplates(siteId: string, tenantId: string, query: PageQueryDto = {}) {
    const { page, pageSize } = normalizePageQuery(query);
    const where: Prisma.price_templatesWhereInput = { siteId, tenantId };
    if (query.search) where.name = { contains: query.search, mode: 'insensitive' };
    const [total, items] = await Promise.all([
      prisma.price_templates.count({ where }),
      prisma.price_templates.findMany({
        where,
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          sku_price_rules: {
            orderBy: [{ durationDays: 'asc' }, { createdAt: 'asc' }],
            include: { sku: { select: { id: true, code: true, name: true, description: true } } },
          },
        },
      }),
    ]);
    return { page, pageSize, total, items };
  }

  async createTemplate(siteId: string, tenantId: string, body: { name: string; description?: string | null; isDefault?: boolean }) {
    if (body.isDefault) {
      return prisma.$transaction(async (tx) => {
        await tx.price_templates.updateMany({ where: { siteId, tenantId, isDefault: true }, data: { isDefault: false } });
        return tx.price_templates.create({ data: { siteId, tenantId, name: body.name, description: body.description ?? null, isDefault: true } });
      });
    }
    return prisma.price_templates.create({ data: { siteId, tenantId, name: body.name, description: body.description ?? null, isDefault: false } });
  }

  private async countTenantProducts(siteId: string, tenantId: string): Promise<number> {
    const template = await this.findDefaultTemplate(siteId, tenantId);
    if (!template) return 0;
    return prisma.sku_price_rules.count({ where: { siteId, templateId: template.id, durationDays: 30, minQty: 1 } });
  }

  private async findDefaultTemplate(siteId: string, tenantId: string): Promise<{ id: string } | null> {
    return prisma.price_templates.findFirst({ where: { siteId, tenantId, isDefault: true }, select: { id: true } });
  }

  private async ensureDefaultTemplate(siteId: string, tenantId: string): Promise<{ id: string }> {
    const existing = await this.findDefaultTemplate(siteId, tenantId);
    if (existing) return existing;
    return prisma.price_templates.create({
      data: {
        siteId,
        tenantId,
        name: '分站默认商品价格',
        description: '分站商品资源管理自动维护的默认售价表',
        isDefault: true,
      },
      select: { id: true },
    });
  }

  async upsertRules(siteId: string, tenantId: string, templateId: string, rules: Array<{
    skuId: string;
    durationDays: number;
    unitPrice: string;
    currency: string;
    minQty?: number;
  }>) {
    const template = await prisma.price_templates.findFirst({ where: { id: templateId, siteId, tenantId } });
    if (!template) throw new AppError(ErrorCode.NOT_FOUND, 'price_template_not_found', 404);
    const skuIds = [...new Set(rules.map((rule) => rule.skuId))];
    const skuCount = await prisma.service_skus.count({
      where: { ...dedicatedLineSkuWhere(siteId), id: { in: skuIds } },
    });
    if (skuCount !== skuIds.length) throw new AppError(ErrorCode.NOT_FOUND, 'sku_not_found', 404);
    return prisma.$transaction(rules.map((rule) =>
      prisma.sku_price_rules.upsert({
        where: {
          siteId_templateId_skuId_durationDays_minQty: {
            siteId,
            templateId,
            skuId: rule.skuId,
            durationDays: rule.durationDays,
            minQty: rule.minQty ?? 1,
          },
        },
        create: { siteId, templateId, skuId: rule.skuId, durationDays: rule.durationDays, unitPrice: rule.unitPrice, currency: rule.currency, minQty: rule.minQty ?? 1 },
        update: { unitPrice: rule.unitPrice, currency: rule.currency, minQty: rule.minQty ?? 1 },
      }),
    ));
  }

  private async summarizeSkuInventory(siteId: string, skuIds: string[]): Promise<Map<string, SkuInventorySummary>> {
    if (skuIds.length === 0) return new Map();
    const snapshots = await prisma.dedicated_line_inventory_snapshots.findMany({
      where: { siteId, skuId: { in: skuIds } },
      select: {
        skuId: true,
        providerAccountId: true,
        countryCode: true,
        providerResourceId: true,
        quantity: true,
        reservedQuantity: true,
        capturedAt: true,
        expiresAt: true,
      },
    });
    const latestByResource = new Map<string, typeof snapshots[number]>();
    for (const snapshot of snapshots) {
      const key = [snapshot.skuId, snapshot.providerAccountId, snapshot.countryCode, snapshot.providerResourceId].join(':');
      const current = latestByResource.get(key);
      if (!current || current.capturedAt < snapshot.capturedAt) latestByResource.set(key, snapshot);
    }

    const now = new Date();
    const summaries = new Map<string, SkuInventorySummary>();
    for (const snapshot of latestByResource.values()) {
      const summary = summaries.get(snapshot.skuId) ?? { availableInventory: 0, inventoryCapturedAt: null, hasSnapshot: false, hasFreshSnapshot: false };
      summary.hasSnapshot = true;
      if (!summary.inventoryCapturedAt || summary.inventoryCapturedAt < snapshot.capturedAt) summary.inventoryCapturedAt = snapshot.capturedAt;
      if (snapshot.expiresAt > now) {
        summary.hasFreshSnapshot = true;
        summary.availableInventory += Math.max(snapshot.quantity - snapshot.reservedQuantity, 0);
      }
      summaries.set(snapshot.skuId, summary);
    }
    return summaries;
  }
}

type ResellerProductRow = Prisma.service_skusGetPayload<{
  include: {
    skuPriceRules: true;
  };
}>;

type SkuInventorySummary = {
  availableInventory: number;
  inventoryCapturedAt: Date | null;
  hasSnapshot: boolean;
  hasFreshSnapshot: boolean;
};

function dedicatedLineSkuWhere(siteId: string): Prisma.service_skusWhereInput {
  return {
    siteId,
    isActive: true,
    isVisible: true,
    capabilities: { path: ['delivery'], equals: 'dedicated-line' },
  };
}

function toResellerProduct(row: ResellerProductRow, inventory?: SkuInventorySummary): ResellerProduct {
  const rule = row.skuPriceRules[0] ?? null;
  return {
    skuId: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    status: row.isActive && row.isVisible ? 'ACTIVE' : 'DISABLED',
    availableInventory: inventory?.hasFreshSnapshot ? inventory.availableInventory : null,
    inventoryCapturedAt: inventory?.inventoryCapturedAt ?? null,
    inventoryIsStale: Boolean(inventory?.hasSnapshot && !inventory.hasFreshSnapshot),
    enabled: Boolean(rule),
    unitPrice: rule?.unitPrice.toString() ?? null,
    currency: rule?.currency ?? null,
  };
}

function isExternalJobStatus(value: string): value is 'QUEUED' | 'LEASED' | 'RETRYING' | 'COMPLETED' | 'FAILED' | 'NEEDS_OPERATOR' {
  return value === 'QUEUED'
    || value === 'LEASED'
    || value === 'RETRYING'
    || value === 'COMPLETED'
    || value === 'FAILED'
    || value === 'NEEDS_OPERATOR';
}
