import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  TenantProviderAccountsFeature,
  buildProviderAccountListPath,
  buildProviderAccountItemPath,
  buildProviderAccountSyncPath,
  buildCreateProviderAccountBody,
  buildUpdateProviderAccountBody,
  PROVIDER_CREDENTIAL_FIELDS,
  type ProviderAccountDto,
} from '../tenant-provider-accounts.feature';
import * as client from '../../../shared/api/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'providerAccounts.reason.provider_credential_invalid': '上游凭据不完整或格式不正确',
    }[key] ?? key),
  }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { queryClient, ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) };
}

function account(overrides: Partial<ProviderAccountDto> = {}): ProviderAccountDto {
  return {
    id: 'acc-1',
    siteId: 'site-1',
    tenantId: 'tenant-1',
    providerCode: 'IPIPD',
    status: 'ACTIVE',
    baseUrl: 'https://api.ipipd.com',
    timeoutMs: 15000,
    inventorySyncEnabled: false,
    createdAt: '2026-06-08T00:00:00.000Z',
    updatedAt: '2026-06-08T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration));
});

describe('tenant provider accounts contracts', () => {
  it('builds tenant-scoped paths against real endpoints', () => {
    expect(buildProviderAccountListPath('tenant 1')).toBe('/api/tenants/tenant%201/provider-accounts');
    expect(buildProviderAccountItemPath('tenant-1', 'acc 1')).toBe('/api/tenants/tenant-1/provider-accounts/acc%201');
    expect(buildProviderAccountSyncPath('tenant-1', 'acc 1')).toBe('/api/tenants/tenant-1/provider-accounts/acc%201/sync-inventory');
  });

  it('builds create body with provider-specific credential fields only', () => {
    expect(
      buildCreateProviderAccountBody({
        providerCode: 'IPIPD',
        baseUrl: ' https://api.ipipd.com ',
        credential: { appId: 'id-1', appSecret: 'secret-1', apikey: 'ignored' },
        timeoutMs: 20000,
        inventorySyncEnabled: true,
      }),
    ).toEqual({
      providerCode: 'IPIPD',
      baseUrl: 'https://api.ipipd.com',
      credential: { appId: 'id-1', appSecret: 'secret-1' },
      timeoutMs: 20000,
      inventorySyncEnabled: true,
    });

    expect(
      buildCreateProviderAccountBody({ providerCode: 'PR', baseUrl: 'https://pr', credential: { apikey: 'k' } }),
    ).toEqual({ providerCode: 'PR', baseUrl: 'https://pr', credential: { apikey: 'k' } });

    expect(PROVIDER_CREDENTIAL_FIELDS.NINE_EIGHT_FIVE).toEqual(['apikey', 'zoneId']);
    expect(
      buildCreateProviderAccountBody({
        providerCode: 'NINE_EIGHT_FIVE',
        baseUrl: 'https://open-api.985proxy.com',
        credential: { apikey: 'key-1', zoneId: 'zone-1', appSecret: 'ignored' },
      }),
    ).toEqual({
      providerCode: 'NINE_EIGHT_FIVE',
      baseUrl: 'https://open-api.985proxy.com',
      credential: { apikey: 'key-1', zoneId: 'zone-1' },
    });
  });

  it('omits credential on update when left blank (keep unchanged)', () => {
    expect(buildUpdateProviderAccountBody(account(), { baseUrl: 'https://new', credential: {} })).toEqual({
      baseUrl: 'https://new',
      timeoutMs: 15000,
      inventorySyncEnabled: false,
    });

    expect(
      buildUpdateProviderAccountBody(account(), { credential: { appId: 'new-id', appSecret: 'new-secret' } }),
    ).toEqual({
      baseUrl: 'https://api.ipipd.com',
      timeoutMs: 15000,
      inventorySyncEnabled: false,
      credential: { appId: 'new-id', appSecret: 'new-secret' },
    });

    expect(
      buildUpdateProviderAccountBody(account({ providerCode: 'NINE_EIGHT_FIVE' }), { credential: { zoneId: 'new-zone' } }),
    ).toEqual({
      baseUrl: 'https://api.ipipd.com',
      timeoutMs: 15000,
      inventorySyncEnabled: false,
      credential: { zoneId: 'new-zone' },
    });
  });

  it('lists accounts via GET and never renders plaintext credentials', async () => {
    vi.spyOn(client, 'apiRequest').mockResolvedValue([account()]);

    renderWithQuery(<TenantProviderAccountsFeature tenantId="tenant-1" />);

    expect(await screen.findByText('https://api.ipipd.com')).toBeInTheDocument();
    expect(screen.queryByText(/secret/i)).not.toBeInTheDocument();
    expect(screen.queryByText('appSecret')).not.toBeInTheDocument();
  });

  it('creates an account posting provider-specific credential body', async () => {
    let createBody: Record<string, unknown> | undefined;
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (init?.method === 'POST') {
        createBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return Promise.resolve(account());
      }
      return Promise.resolve([]);
    });

    renderWithQuery(<TenantProviderAccountsFeature tenantId="tenant-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'providerAccounts.create' }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText('providerAccounts.baseUrl'), {
      target: { value: 'https://api.ipipd.com' },
    });
    fireEvent.change(within(dialog).getByLabelText('providerAccounts.credential.appId'), {
      target: { value: 'id-1' },
    });
    fireEvent.change(within(dialog).getByLabelText('providerAccounts.credential.appSecret'), {
      target: { value: 'secret-1' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'providerAccounts.form.submit' }));

    await waitFor(() =>
      expect(createBody).toMatchObject({
        providerCode: 'IPIPD',
        baseUrl: 'https://api.ipipd.com',
        credential: { appId: 'id-1', appSecret: 'secret-1' },
      }),
    );
  });

  it('disables an account only after confirmation, then invalidates the query', async () => {
    let deleteCalled = false;
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (init?.method === 'DELETE') {
        deleteCalled = true;
        return Promise.resolve(account({ status: 'DISABLED' }));
      }
      return Promise.resolve([account()]);
    });

    const { queryClient } = renderWithQuery(<TenantProviderAccountsFeature tenantId="tenant-1" />);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await screen.findByText('https://api.ipipd.com');
    fireEvent.click(screen.getByRole('button', { name: /providerAccounts\.operations\.more/ }));
    fireEvent.click(await screen.findByText('providerAccounts.disable'));
    expect(deleteCalled).toBe(false);

    const confirmButtons = await screen.findAllByRole('button', { name: 'providerAccounts.disable' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    await waitFor(() => expect(deleteCalled).toBe(true));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['provider-accounts', 'tenant-1'] }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['resources-list'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['resources-countries'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pricing-matrix'] });
  });

  it('syncs tenant inventory and refreshes pricing/resource queries after saving an active sync-enabled account', async () => {
    const updatePath = buildProviderAccountItemPath('tenant-1', 'acc-1');
    const syncPath = buildProviderAccountSyncPath('tenant-1', 'acc-1');
    const requests: Array<{ path: string; method: string | undefined }> = [];
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      requests.push({ path: String(path), method: init?.method });
      if (path === updatePath && init?.method === 'PUT') {
        return Promise.resolve(account({
          baseUrl: 'https://api.sandbox.ipipd.cn',
          inventorySyncEnabled: true,
        }));
      }
      if (path === syncPath && init?.method === 'POST') {
        return Promise.resolve({
          attempted: 1,
          created: 1,
          updated: 0,
          skipped: 0,
          failed: 0,
          synced: 1,
          syncedAt: '2026-06-26T00:00:00.000Z',
          upstreamRawStatus: 'ready',
          countries: ['GB'],
        });
      }
      return Promise.resolve([account({ inventorySyncEnabled: true })]);
    });

    const { queryClient } = renderWithQuery(<TenantProviderAccountsFeature tenantId="tenant-1" />);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await screen.findByText('https://api.ipipd.com');
    fireEvent.click(screen.getByRole('button', { name: /providerAccounts\.operations\.more/ }));
    fireEvent.click(await screen.findByText('providerAccounts.edit'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('providerAccounts.baseUrl'), {
      target: { value: 'https://api.sandbox.ipipd.cn' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'providerAccounts.form.submit' }));

    await waitFor(() => {
      expect(requests).toContainEqual({ path: syncPath, method: 'POST' });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['provider-accounts', 'tenant-1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['resources-list'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['resources-countries'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pricing-matrix'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin-user-price-resources'] });
  });

  it('shows the backend reasonKey when create fails', async () => {
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (init?.method === 'POST') {
        return Promise.reject(new client.ApiError('VALIDATION_ERROR', 'provider_credential_invalid'));
      }
      return Promise.resolve([]);
    });

    renderWithQuery(<TenantProviderAccountsFeature tenantId="tenant-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'providerAccounts.create' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('providerAccounts.baseUrl'), {
      target: { value: 'https://api.ipipd.com' },
    });
    fireEvent.change(within(dialog).getByLabelText('providerAccounts.credential.appId'), {
      target: { value: 'id-1' },
    });
    fireEvent.change(within(dialog).getByLabelText('providerAccounts.credential.appSecret'), {
      target: { value: 'secret-1' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'providerAccounts.form.submit' }));

    expect(await screen.findByText('上游凭据不完整或格式不正确')).toBeInTheDocument();
    expect(screen.queryByText('provider_credential_invalid')).not.toBeInTheDocument();
  });
});
