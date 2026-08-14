import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  buildApiKeyListPath,
  buildCreateApiKeyBody,
  buildRevokeApiKeyPath,
  AdminApiKeyListFeature,
} from '../api-key-list.feature';
import * as client from '../../../shared/api/client';
import { clearCurrentUserCache } from '../../../shared/auth/current-user';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { queryClient, ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) };
}

const CURRENT_ADMIN = {
  ownerId: 'admin-1',
  ownerType: 'TENANT_ADMIN' as const,
  siteId: 'site-1',
  tenantId: 'tenant-1',
  scopes: [],
};

const PLATFORM_ADMIN = {
  ownerId: 'platform-1',
  ownerType: 'PLATFORM_ADMIN' as const,
  siteId: 'site-1',
  tenantId: null,
  scopes: [],
};

function apiKeyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'key-1',
    name: 'Tenant ops',
    keyPrefix: 'abcd1234',
    scopes: ['res_static:*'],
    ipWhitelist: [],
    status: 'ACTIVE',
    createdAt: '2026-06-08T00:00:00.000Z',
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  clearCurrentUserCache('admin');
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration));
});

describe('admin api key feature contracts', () => {
  it('builds list, create, and revoke paths against real endpoints', () => {
    expect(buildApiKeyListPath(1, 20)).toBe('/api/api-keys?page=1&pageSize=20');
    expect(buildRevokeApiKeyPath('key 1')).toBe('/api/api-keys/key%201');
  });

  it('injects tenantId into the create body and omits empty ipWhitelist', () => {
    expect(buildCreateApiKeyBody({ tenantId: 'tenant-1', name: ' Tenant ops ', scopes: ['res_static:*'] })).toEqual({
      tenantId: 'tenant-1',
      name: 'Tenant ops',
      scopes: ['res_static:*'],
    });
    expect(
      buildCreateApiKeyBody({ tenantId: 'tenant-1', name: 'Tenant ops', scopes: ['a'], ipWhitelist: ['203.0.113.10'] }),
    ).toEqual({ tenantId: 'tenant-1', name: 'Tenant ops', scopes: ['a'], ipWhitelist: ['203.0.113.10'] });
  });

  it('lists keys through GET /api/api-keys via admin apiRequest', async () => {
    const spy = vi.spyOn(client, 'apiRequest').mockImplementation((path) => {
      if (path === '/api/auth/me') return Promise.resolve(CURRENT_ADMIN);
      return Promise.resolve({
        page: 1,
        pageSize: 20,
        total: 1,
        items: [apiKeyRow({ ipWhitelist: ['203.0.113.10'], revokedAt: '2026-06-09T00:00:00.000Z', status: 'REVOKED' })],
      });
    });

    renderWithQuery(<AdminApiKeyListFeature />);

    expect(await screen.findByText('abcd1234')).toBeInTheDocument();
    expect(await screen.findByText('Tenant ops')).toBeInTheDocument();
    expect(await screen.findByText('203.0.113.10')).toBeInTheDocument();
    expect(await screen.findByText(/adminApiKeys\.revoke/)).toBeInTheDocument();
    expect(spy.mock.calls.some((c) => String(c[0]).startsWith('/api/api-keys?'))).toBe(true);
  });

  it('does not render tenant API key operations or call the list endpoint for PLATFORM_ADMIN', async () => {
    const spy = vi.spyOn(client, 'apiRequest').mockImplementation((path) => {
      if (path === '/api/auth/me') return Promise.resolve(PLATFORM_ADMIN);
      return Promise.resolve({ page: 1, pageSize: 20, total: 1, items: [apiKeyRow()] });
    });

    renderWithQuery(<AdminApiKeyListFeature />);

    expect(await screen.findByText('insufficient_permissions')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'adminApiKeys.create' })).not.toBeInTheDocument();
    expect(screen.queryByText('adminApiKeys.revoke')).not.toBeInTheDocument();
    expect(spy.mock.calls.every((c) => !String(c[0]).startsWith('/api/api-keys'))).toBe(true);
  });

  it('shows the one-time plainKey after a successful create with injected tenantId', async () => {
    let createBody: Record<string, unknown> | undefined;
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path === '/api/auth/me') return Promise.resolve(CURRENT_ADMIN);
      if (path === '/api/api-keys' && init?.method === 'POST') {
        createBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return Promise.resolve({ ...apiKeyRow(), plainKey: 'plain-secret-key' });
      }
      return Promise.resolve({ page: 1, pageSize: 20, total: 0, items: [] });
    });

    renderWithQuery(<AdminApiKeyListFeature />);

    fireEvent.click(await screen.findByRole('button', { name: 'adminApiKeys.create' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('adminApiKeys.form.name'), {
      target: { value: 'Tenant ops' },
    });
    const scopesInput = within(dialog).getAllByRole('combobox')[0]!;
    fireEvent.mouseDown(scopesInput);
    fireEvent.change(scopesInput, { target: { value: 'res_static:*' } });
    fireEvent.keyDown(scopesInput, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });

    fireEvent.click(within(dialog).getByRole('button', { name: 'adminApiKeys.form.submit' }));

    await waitFor(() => expect(createBody).toMatchObject({
      tenantId: 'tenant-1',
      name: 'Tenant ops',
      scopes: ['res_static:*'],
    }));
    expect(await screen.findByText('plain-secret-key')).toBeInTheDocument();
  });

  it('revokes a key only after confirmation, then invalidates the admin-api-keys query', async () => {
    let deleteCalled = false;
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path === '/api/auth/me') return Promise.resolve(CURRENT_ADMIN);
      if (path === '/api/api-keys/key-1' && init?.method === 'DELETE') {
        deleteCalled = true;
        return Promise.resolve(undefined);
      }
      return Promise.resolve({ page: 1, pageSize: 20, total: 1, items: [apiKeyRow()] });
    });

    const { queryClient } = renderWithQuery(<AdminApiKeyListFeature />);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await screen.findByText('abcd1234');
    fireEvent.click(screen.getByRole('button', { name: /adminApiKeys\.operations\.more/ }));
    fireEvent.click(await screen.findByText('adminApiKeys.revoke'));

    expect(deleteCalled).toBe(false);

    const confirmButtons = await screen.findAllByRole('button', { name: 'adminApiKeys.revoke' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    await waitFor(() => expect(deleteCalled).toBe(true));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin-api-keys'] }),
    );
  });

  it('shows the backend reasonKey when revoke fails', async () => {
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (path === '/api/auth/me') return Promise.resolve(CURRENT_ADMIN);
      if (path === '/api/api-keys/key-1' && init?.method === 'DELETE') {
        return Promise.reject(new client.ApiError('NOT_FOUND', 'api_key_not_found'));
      }
      return Promise.resolve({ page: 1, pageSize: 20, total: 1, items: [apiKeyRow()] });
    });

    renderWithQuery(<AdminApiKeyListFeature />);

    await screen.findByText('abcd1234');
    fireEvent.click(screen.getByRole('button', { name: /adminApiKeys\.operations\.more/ }));
    fireEvent.click(await screen.findByText('adminApiKeys.revoke'));
    const confirmButtons = await screen.findAllByRole('button', { name: 'adminApiKeys.revoke' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    expect(await screen.findByText('api_key_not_found')).toBeInTheDocument();
  });
});
