import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UserPricingFeature, buildUserBindingBody, buildUserOverrideBody } from '../user-pricing.feature';
import * as client from '../../../shared/api/client';
import { formatIpTypeZh, formatResourceLocationZh } from '../../../shared/resource/resource-labels';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  return { queryClient, invalidateSpy, ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) };
}

const RESOURCE = {
  id: 'res-1',
  code: 'JP_TOKYO',
  name: 'Japan Tokyo',
  displayName: '日本东京',
  providerCode: 'IPIPD',
  ipType: 'NATIVE',
  countryCode: 'JP',
  upstreamResourceId: 'JP:tokyo',
};

const RESOURCE_OPTION_LABEL = `${formatResourceLocationZh(RESOURCE).title} / ${formatIpTypeZh(RESOURCE.ipType)}`;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration));
});

function getFormBySubmitButton(buttonLabel: string) {
  const form = screen.getByRole('button', { name: buttonLabel }).closest('form');
  if (!form) {
    throw new Error(`form not found for button ${buttonLabel}`);
  }
  return form;
}

function getFormInput(form: Element, fieldId: string) {
  const input = form.querySelector(`#${fieldId}`) as HTMLElement | null;
  if (!input) {
    throw new Error(`field #${fieldId} not found`);
  }
  return input;
}

async function openFormSelectAndPick(form: Element, fieldId: string, optionText: string) {
  fireEvent.mouseDown(getFormInput(form, fieldId));
  const option = await screen.findByText(optionText);
  fireEvent.click(option);
}

describe('UserPricingFeature', () => {
  it('invalidates resource pricing surfaces after saving a user override', async () => {
    const apiSpy = vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path.startsWith('/api/resources/priceable-catalog')) {
        return Promise.resolve({
          page: 1,
          pageSize: 500,
          total: 1,
          items: [RESOURCE],
        });
      }
      if (path.startsWith('/api/pricing/templates')) {
        return Promise.resolve({ items: [{ id: 'template-1', name: 'Global Default' }] });
      }
      if (path === '/api/pricing/user-overrides' && init?.method === 'POST') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    const { invalidateSpy } = renderWithQuery(<UserPricingFeature />);
    const overrideForm = getFormBySubmitButton('pricing.userOverride.submit');

    fireEvent.change(getFormInput(overrideForm, 'pricing-user-override-tenantId'), { target: { value: 'tenant-1' } });
    fireEvent.change(getFormInput(overrideForm, 'pricing-user-override-userId'), { target: { value: 'user-1' } });
    await openFormSelectAndPick(overrideForm, 'pricing-user-override-resourceId', RESOURCE_OPTION_LABEL);
    fireEvent.change(getFormInput(overrideForm, 'pricing-user-override-unitPrice'), { target: { value: '19.8' } });
    fireEvent.click(screen.getByRole('button', { name: 'pricing.userOverride.submit' }));

    await waitFor(() => expect(apiSpy).toHaveBeenCalledWith('/api/pricing/user-overrides', expect.any(Object)));
    expect(buildUserOverrideBody({
      tenantId: ' tenant-1 ',
      userId: ' user-1 ',
      resourceId: 'res-1',
      unitPrice: '19.8',
      currency: 'CNY',
    })).toEqual({
      tenantId: 'tenant-1',
      userId: 'user-1',
      resourceId: 'res-1',
      durationDays: 30,
      unitPrice: '19.8',
      currency: 'CNY',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['price-templates'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['resources'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['resources-list'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['resources-countries'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['resources', 'quick-price-catalog'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pricing-resources'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin-user-price-resources'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin-assisted-order-resources'] });
  });

  it('invalidates resource pricing surfaces after binding a user template', async () => {
    const apiSpy = vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path.startsWith('/api/resources/priceable-catalog')) {
        return Promise.resolve({
          page: 1,
          pageSize: 500,
          total: 1,
          items: [RESOURCE],
        });
      }
      if (path.startsWith('/api/pricing/templates')) {
        return Promise.resolve({ items: [{ id: 'template-1', name: 'Global Default' }] });
      }
      if (path === '/api/pricing/user-template-bindings' && init?.method === 'POST') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    const { invalidateSpy } = renderWithQuery(<UserPricingFeature />);
    const bindingForm = getFormBySubmitButton('pricing.userBinding.submit');

    fireEvent.change(getFormInput(bindingForm, 'pricing-user-binding-tenantId'), { target: { value: 'tenant-1' } });
    fireEvent.change(getFormInput(bindingForm, 'pricing-user-binding-userId'), { target: { value: 'user-1' } });
    await openFormSelectAndPick(bindingForm, 'pricing-user-binding-templateId', 'Global Default');
    fireEvent.click(screen.getByRole('button', { name: 'pricing.userBinding.submit' }));

    await waitFor(() => expect(apiSpy).toHaveBeenCalledWith('/api/pricing/user-template-bindings', expect.any(Object)));
    expect(buildUserBindingBody({
      tenantId: ' tenant-1 ',
      userId: ' user-1 ',
      templateId: 'template-1',
    })).toEqual({
      tenantId: 'tenant-1',
      userId: 'user-1',
      templateId: 'template-1',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['price-templates'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['resources'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['resources-list'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['resources-countries'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['resources', 'quick-price-catalog'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pricing-resources'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin-user-price-resources'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin-assisted-order-resources'] });
  });
});
