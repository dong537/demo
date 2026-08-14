import { describe, expect, it } from 'vitest';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { selectSkuPrice, SkuPriceCandidate, SkuQuoteUseCase } from './domain';

describe('SKU catalog domain', () => {
  it('selects the first price source in the dedicated SKU priority order', () => {
    const userTemplate: SkuPriceCandidate = {
      unitPrice: '18.00',
      currency: 'CNY',
      source: 'USER_TEMPLATE',
    };

    expect(selectSkuPrice([
      { source: 'USER_OVERRIDE', candidates: [], hasCurrencyMismatch: false },
      { source: 'USER_TEMPLATE', candidates: [userTemplate], hasCurrencyMismatch: true },
      { source: 'TENANT_DEFAULT_TEMPLATE', candidates: [{ unitPrice: '20', currency: 'CNY', source: 'TENANT_DEFAULT_TEMPLATE' }], hasCurrencyMismatch: true },
      { source: 'SITE_OVERRIDE', candidates: [{ unitPrice: '22', currency: 'CNY', source: 'SITE_OVERRIDE' }], hasCurrencyMismatch: true },
    ], 'CNY')).toEqual(userTemplate);
  });

  it('reports a currency mismatch instead of silently choosing another currency', () => {
    expect(() => selectSkuPrice([
      {
        source: 'SITE_OVERRIDE',
        candidates: [{ unitPrice: '22', currency: 'USD', source: 'SITE_OVERRIDE' }],
        hasCurrencyMismatch: true,
      },
    ], 'CNY')).toThrowError(new AppError(ErrorCode.CURRENCY_NOT_SUPPORTED, 'sku_currency_not_supported', 422));
  });

  it('freezes the quote contract snapshot needed by a later order save', async () => {
    const useCase = new SkuQuoteUseCase({
      assertBuyerScope: async () => undefined,
      findSku: async () => ({
        id: 'sku-sv',
        siteId: 'site-1',
        code: 'SV',
        name: 'Short video',
        description: null,
        isActive: true,
        isVisible: true,
        contractVersion: 2,
        capabilities: { delivery: 'dedicated-line', protocols: ['VLESS', 'VMESS'] },
      }),
      getPriceCandidates: async () => [
        { source: 'SITE_DEFAULT_TEMPLATE', candidates: [{ unitPrice: '12.50', currency: 'CNY', source: 'SITE_DEFAULT_TEMPLATE' }], hasCurrencyMismatch: true },
      ],
    });

    const quote = await useCase.execute({
      siteId: 'site-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      skuCode: 'SV',
      durationDays: 30,
      quantity: 2,
      currency: 'CNY',
    });

    expect(quote).toMatchObject({
      skuId: 'sku-sv',
      skuCode: 'SV',
      unitPrice: '12.5',
      totalPrice: '25',
      priceSource: 'SITE_DEFAULT_TEMPLATE',
      contractVersion: 2,
    });
    expect(Object.isFrozen(quote.contract)).toBe(true);
    expect(Object.isFrozen(quote.contract.capabilities)).toBe(true);
    expect(Object.isFrozen(quote)).toBe(true);
    expect(() => {
      (quote.contract.capabilities as Record<string, unknown>).delivery = 'residential';
    }).toThrow();
  });

  it('rejects a buyer outside the requested site and tenant before reading SKU pricing', async () => {
    let skuRead = false;
    const useCase = new SkuQuoteUseCase({
      assertBuyerScope: async () => {
        throw new AppError(ErrorCode.NOT_FOUND, 'user_not_found', 404);
      },
      findSku: async () => {
        skuRead = true;
        return null;
      },
      getPriceCandidates: async () => [],
    });

    await expect(useCase.execute({
      siteId: 'site-1',
      tenantId: 'tenant-1',
      userId: 'cross-tenant-user',
      skuCode: 'SV',
      durationDays: 30,
      quantity: 1,
      currency: 'CNY',
    })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      reasonKey: 'user_not_found',
    });
    expect(skuRead).toBe(false);
  });
});
