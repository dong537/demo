import { Injectable } from '@nestjs/common';
import { prisma, Prisma, LedgerEntryType } from '@ipeasy/db';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { addMoney, subtractMoney, toDecimalString } from '../../common/money/money';
import { assertSufficientBalance } from './domain';
import { PageQueryDto, PageResult, normalizePageQuery } from '../../common/pagination/pagination.dto';

export type Wallet = Prisma.walletsGetPayload<Record<string, never>>;
export type LedgerEntry = Prisma.ledger_entriesGetPayload<Record<string, never>>;
type PrismaTransactionClient = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

@Injectable()
export class WalletRepository {
  async getWalletByUserId(userId: string, siteId: string, tenantId?: string | null): Promise<Wallet> {
    const where: Prisma.walletsWhereInput = { userId, siteId };
    if (tenantId) where.tenantId = tenantId;

    const wallet = await prisma.wallets.findFirst({ where });
    if (!wallet) throw new AppError(ErrorCode.NOT_FOUND, 'wallet_not_found', 404);
    return wallet;
  }

  async listLedgerEntries(
    walletId: string,
    tenantId: string,
    query: PageQueryDto & { type?: LedgerEntryType; from?: string; to?: string },
  ): Promise<PageResult<LedgerEntry>> {
    const { page, pageSize } = normalizePageQuery(query);
    const where: Prisma.ledger_entriesWhereInput = { walletId, tenantId };
    if (query.type) where.type = query.type;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const [total, items] = await Promise.all([
      prisma.ledger_entries.count({ where }),
      prisma.ledger_entries.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { page, pageSize, total, items };
  }

  async creditWalletTx(
    tx: PrismaTransactionClient,
    walletId: string,
    amount: string,
    currency: string,
    type: LedgerEntryType,
    relatedId: string,
    reason: string,
    idempotencyKey: string,
  ): Promise<LedgerEntry> {
    const wallet = await tx.wallets.findUnique({ where: { id: walletId } });
    if (!wallet) throw new AppError(ErrorCode.NOT_FOUND, 'wallet_not_found', 404);
    if (wallet.currency !== currency) {
      throw new AppError(ErrorCode.CURRENCY_NOT_SUPPORTED, 'currency_mismatch', 422, `Expected ${wallet.currency}, got ${currency}`);
    }

    const existing = await tx.ledger_entries.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (
        existing.walletId !== walletId ||
        existing.type !== type ||
        existing.relatedId !== relatedId ||
        existing.currency !== currency ||
        existing.amount.toString() !== toDecimalString(amount)
      ) {
        throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'ledger_idempotency_conflict', 409);
      }
      return existing;
    }

    const newAvailable = addMoney(wallet.available.toString(), amount);
    const updated = await tx.wallets.updateMany({
      where: { id: walletId, version: wallet.version },
      data: { available: newAvailable, version: { increment: 1 } },
    });
    if (updated.count === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'wallet_concurrent_update', 409);
    }

    return tx.ledger_entries.create({
      data: {
        siteId: wallet.siteId,
        tenantId: wallet.tenantId,
        walletId,
        userId: wallet.userId,
        type,
        amount,
        balanceAfter: newAvailable,
        currency,
        relatedId,
        reason,
        idempotencyKey,
      },
    });
  }

  async debitWalletTx(
    tx: PrismaTransactionClient,
    walletId: string,
    amount: string,
    currency: string,
    type: LedgerEntryType,
    relatedId: string,
    reason: string,
    idempotencyKey: string,
  ): Promise<LedgerEntry> {
    const wallet = await tx.wallets.findUnique({ where: { id: walletId } });
    if (!wallet) throw new AppError(ErrorCode.NOT_FOUND, 'wallet_not_found', 404);
    if (wallet.currency !== currency) {
      throw new AppError(ErrorCode.CURRENCY_NOT_SUPPORTED, 'currency_mismatch', 422, `Expected ${wallet.currency}, got ${currency}`);
    }

    const existing = await tx.ledger_entries.findUnique({ where: { idempotencyKey } });
    const ledgerAmount = toDecimalString(`-${amount}`);
    if (existing) {
      if (
        existing.walletId !== walletId ||
        existing.type !== type ||
        existing.relatedId !== relatedId ||
        existing.currency !== currency ||
        existing.amount.toString() !== ledgerAmount
      ) {
        throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'ledger_idempotency_conflict', 409);
      }
      return existing;
    }

    assertSufficientBalance(wallet.available.toString(), amount);

    const newAvailable = subtractMoney(wallet.available.toString(), amount);
    const updated = await tx.wallets.updateMany({
      where: { id: walletId, version: wallet.version, available: { gte: amount } },
      data: { available: newAvailable, version: { increment: 1 } },
    });
    if (updated.count === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'wallet_concurrent_update', 409);
    }

    return tx.ledger_entries.create({
      data: {
        siteId: wallet.siteId,
        tenantId: wallet.tenantId,
        walletId,
        userId: wallet.userId,
        type,
        amount: ledgerAmount,
        balanceAfter: newAvailable,
        currency,
        relatedId,
        reason,
        idempotencyKey,
      },
    });
  }
}
