import { describe, expect, it } from 'vitest';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { SkuQuoteUseCase } from '../domain';

describe('SkuQuoteUseCase', () => {
  it('rejects an inactive SKU without consulting any price or provider source', async () => {
    let priceReads = 0;
    const useCase = new SkuQuoteUseCase({
      assertBuyerScope: async () => undefined,
      findSku: async () => ({
        id: 'sku-zb',
        siteId: 'site-1',
        code: 'ZB',
        name: 'Live',
        description: null,
        isActive: false,
        isVisible: false,
        contractVersion: 1,
        capabilities: { delivery: 'dedicated-line' },
      }),
      getPriceCandidates: async () => {
        priceReads += 1;
        return [];
      },
    });

    await expect(useCase.execute({
      siteId: 'site-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      skuCode: 'ZB',
      durationDays: 30,
      quantity: 1,
      currency: 'CNY',
    })).rejects.toMatchObject({
      code: ErrorCode.PRODUCT_DISABLED,
      reasonKey: 'sku_not_saleable',
      httpStatus: 410,
    });
    expect(priceReads).toBe(0);
  });

  it('rejects a missing SKU with a stable not-found error', async () => {
    const useCase = new SkuQuoteUseCase({
      assertBuyerScope: async () => undefined,
      findSku: async () => null,
      getPriceCandidates: async () => [],
    });

    await expect(useCase.execute({
      siteId: 'site-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      skuCode: 'UNKNOWN',
      durationDays: 30,
      quantity: 1,
      currency: 'CNY',
    })).rejects.toThrowError(new AppError(ErrorCode.NOT_FOUND, 'sku_not_found', 404));
  });

  it('rejects a visible residential SKU from the dedicated catalog quote path', async () => {
    let priceReads = 0;
    const useCase = new SkuQuoteUseCase({
      assertBuyerScope: async () => undefined,
      findSku: async () => ({
        id: 'sku-residential',
        siteId: 'site-1',
        code: 'RES',
        name: 'Legacy residential',
        description: null,
        isActive: true,
        isVisible: true,
        contractVersion: 1,
        capabilities: { delivery: 'residential' },
      }),
      getPriceCandidates: async () => {
        priceReads += 1;
        return [];
      },
    });

    await expect(useCase.execute({
      siteId: 'site-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      skuCode: 'RES',
      durationDays: 30,
      quantity: 1,
      currency: 'CNY',
    })).rejects.toMatchObject({
      code: ErrorCode.UNSUPPORTED_CAPABILITY,
      reasonKey: 'sku_not_dedicated_line',
      httpStatus: 422,
    });
    expect(priceReads).toBe(0);
  });
});
