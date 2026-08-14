import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PriceTemplateFeature, buildPriceRuleBody } from '../price-template.feature';
import * as client from '../../../shared/api/client';
import { formatResourceLocationZh } from '../../../shared/resource/resource-labels';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  return {
    queryClient,
    invalidateSpy,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  };
}

const RESOURCE = {
  id: 'res-1',
  code: 'JP:tokyo',
  name: 'Japan Tokyo',
  displayName: 'Japan-Tokyo Recommended',
  countryCode: 'JP',
  upstreamResourceId: 'JP:tokyo',
};

const TEMPLATE_ROW = {
  id: 'template-1',
  name: 'Global Default',
  price_rules: [],
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration));
});

async function openSelectAndPick(optionText: string) {
  const trigger = document.querySelector('.ant-select-selector');
  if (!(trigger instanceof HTMLElement)) {
    throw new Error('select trigger not found');
  }
  fireEvent.mouseDown(trigger);
  fireEvent.click(await screen.findByText(optionText));
}

describe('PriceTemplateFeature', () => {
  it('invalidates pricing-related resource queries after creating a template', async () => {
    const apiSpy = vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path === '/api/pricing/templates?page=1&pageSize=20') {
        return Promise.resolve({ page: 1, pageSize: 20, total: 1, items: [TEMPLATE_ROW] });
      }
      if (path === '/api/resources?page=1&pageSize=20&status=ACTIVE') {
        return Promise.resolve({ page: 1, pageSize: 20, total: 1, items: [RESOURCE] });
      }
      if (path === '/api/pricing/templates' && init?.method === 'POST') {
        return Promise.resolve({ id: 'template-2' });
      }
      return Promise.resolve({ page: 1, pageSize: 20, total: 0, items: [] });
    });

    const { invalidateSpy } = renderWithQuery(<PriceTemplateFeature />);

    fireEvent.click(await screen.findByRole('button', { name: 'pricing.createTemplate' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Tenant Promo' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(apiSpy).toHaveBeenCalledWith('/api/pricing/templates', expect.any(Object)));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['price-templates'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pricing-matrix'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pricing-resources'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['resources'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['resources-list'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['resources-countries'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['resources', 'quick-price-catalog'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin-user-price-resources'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin-assisted-order-resources'] });
  });

  it('invalidates pricing-related resource queries after adding a template rule', async () => {
    const apiSpy = vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path === '/api/pricing/templates?page=1&pageSize=20') {
        return Promise.resolve({ page: 1, pageSize: 20, total: 1, items: [TEMPLATE_ROW] });
      }
      if (path === '/api/resources?page=1&pageSize=20&status=ACTIVE') {
        return Promise.resolve({ page: 1, pageSize: 20, total: 1, items: [RESOURCE] });
      }
      if (path === '/api/resources?page=2&pageSize=20&status=ACTIVE') {
        return Promise.resolve({ page: 2, pageSize: 20, total: 1, items: [] });
      }
      if (path === '/api/pricing/templates/template-1/rules' && init?.method === 'POST') {
        return Promise.resolve({ id: 'rule-1' });
      }
      return Promise.resolve({ page: 1, pageSize: 20, total: 0, items: [] });
    });

    const { invalidateSpy } = renderWithQuery(<PriceTemplateFeature />);
    const optionLabel = formatResourceLocationZh(RESOURCE).title;

    fireEvent.click(await screen.findByRole('button', { name: 'pricing.addRule' }));
    await openSelectAndPick(optionLabel);

    const spinbuttons = screen.getAllByRole('spinbutton');
    fireEvent.change(spinbuttons[0]!, { target: { value: '18.8' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(apiSpy).toHaveBeenCalledWith('/api/pricing/templates/template-1/rules', expect.any(Object)));
    expect(buildPriceRuleBody({
      resourceId: 'res-1',
      unitPrice: '18.8',
      currency: 'CNY',
      minQty: 1,
    })).toEqual({
      resourceId: 'res-1',
      durationDays: 30,
      unitPrice: '18.8',
      currency: 'CNY',
      minQty: 1,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['price-templates'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pricing-matrix'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pricing-resources'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['resources'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['resources-list'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['resources-countries'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['resources', 'quick-price-catalog'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin-user-price-resources'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin-assisted-order-resources'] });
  });
});
