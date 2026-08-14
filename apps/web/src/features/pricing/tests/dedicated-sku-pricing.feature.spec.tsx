import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DedicatedSkuPricingFeature, buildDedicatedSkuPriceBody } from '../dedicated-sku-pricing.feature';
import * as client from '../../../shared/api/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderWithQuery(ui: React.ReactElement) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
}

beforeEach(() => vi.restoreAllMocks());

describe('DedicatedSkuPricingFeature', () => {
  it('renders the server-owned SV and ZB pricing rows', async () => {
    vi.spyOn(client, 'apiRequest').mockResolvedValue({
      templateId: 'template-1',
      items: [
        { skuId: 'sku-sv', code: 'SV', name: 'Short Video', description: null, templateRules: [], globalOverrides: [] },
        { skuId: 'sku-zb', code: 'ZB', name: 'Live Streaming', description: null, templateRules: [], globalOverrides: [] },
      ],
    });
    renderWithQuery(<DedicatedSkuPricingFeature />);
    expect(await screen.findByText('SV')).toBeInTheDocument();
    expect(screen.getByText('ZB')).toBeInTheDocument();
  });

  it('posts a normalized global SKU override', async () => {
    const apiSpy = vi.spyOn(client, 'apiRequest').mockImplementation((path) => {
      if (path === '/api/pricing/dedicated-skus') {
        return Promise.resolve({ templateId: 'template-1', items: [{ skuId: 'sku-sv', code: 'SV', name: 'Short Video', description: null, templateRules: [], globalOverrides: [] }] });
      }
      return Promise.resolve({ id: 'override-1' });
    });
    renderWithQuery(<DedicatedSkuPricingFeature />);
    await screen.findByText('SV');
    fireEvent.click(screen.getByRole('button', { name: /pricing\.dedicatedSku\.editGlobal/ }));
    fireEvent.change(screen.getByLabelText('pricing.dedicatedSku.unitPrice'), { target: { value: '35' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(apiSpy).toHaveBeenCalledWith('/api/pricing/dedicated-skus/overrides', expect.objectContaining({ method: 'POST' })));
    expect(buildDedicatedSkuPriceBody({ skuId: 'sku-sv', durationDays: 30, minQty: 1, unitPrice: 35, currency: 'CNY' })).toEqual({
      skuId: 'sku-sv', durationDays: 30, minQty: 1, unitPrice: '35', currency: 'CNY',
    });
  });
});
