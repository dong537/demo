import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  buildApiKeyListPath,
  buildCreateApiKeyBody,
  buildRevokeApiKeyPath,
  apiKeyStatusColor,
  CustomerApiKeyListFeature,
} from '../api-key-list.feature';
import * as client from '../../../shared/api/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'customer.apiKeys.reason.api_key_not_found') return 'API key was not found';
      if (key === 'customer.apiKeys.statusValue.ACTIVE') return 'Active';
      if (key === 'customer.apiKeys.statusValue.REVOKED') return 'Revoked';
      return key;
    },
  }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { queryClient, ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) };
}

const CURRENT_USER = {
  ownerId: 'user-1',
  ownerType: 'USER' as const,
  siteId: 'site-1',
  tenantId: 'tenant-1',
  scopes: [],
};

function apiKeyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'key-1',
    name: 'Order automation',
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
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration));
});

describe('customer api key feature contracts', () => {
  it('builds list, create, and revoke paths against real endpoints', () => {
    expect(buildApiKeyListPath(1, 20)).toBe('/api/api-keys?page=1&pageSize=20');
    expect(buildRevokeApiKeyPath('key 1')).toBe('/api/api-keys/key%201');
  });

  it('maps known and unknown key statuses to operational tag colors', () => {
    expect(apiKeyStatusColor('ACTIVE')).toBe('success');
    expect(apiKeyStatusColor('REVOKED')).toBe('default');
    expect(apiKeyStatusColor('DISABLED')).toBe('default');
    expect(apiKeyStatusColor('ROTATING')).toBe('processing');
  });

  it('creates dedicated read keys by default and preserves the legacy residential preset explicitly', () => {
    expect(buildCreateApiKeyBody({ tenantId: 'tenant-1', name: ' Order automation ' })).toEqual({
      tenantId: 'tenant-1',
      name: 'Order automation',
      scopes: ['dedicated:*'],
      ipWhitelist: [],
    });
    expect(buildCreateApiKeyBody({ tenantId: 'tenant-1', name: 'Legacy reader', purpose: 'RESIDENTIAL' })).toMatchObject({
      scopes: ['res_static:*'],
    });
  });

  it('lists keys through GET /api/api-keys', async () => {
    const spy = vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      if (path === '/api/auth/me') return Promise.resolve(CURRENT_USER);
      return Promise.resolve({
        page: 1,
        pageSize: 20,
        total: 2,
        items: [
          apiKeyRow({ lastUsedAt: '2026-06-09T00:00:00.000Z' }),
          apiKeyRow({ id: 'key-2', name: 'Legacy integration', keyPrefix: 'efgh5678', status: 'REVOKED' }),
        ],
      });
    });

    renderWithQuery(<CustomerApiKeyListFeature />);

    expect(await screen.findByText('abcd1234')).toBeInTheDocument();
    expect(await screen.findByText('efgh5678')).toBeInTheDocument();
    expect(await screen.findByText('Order automation')).toBeInTheDocument();
    expect(await screen.findByText('Legacy integration')).toBeInTheDocument();
    expect(screen.getAllByText('customer.apiKeys.keyId')).toHaveLength(2);
    expect(screen.getAllByText('customer.apiKeys.lastUsedInline')).not.toHaveLength(0);
    expect(screen.getAllByText('customer.apiKeys.createdInline')).not.toHaveLength(0);
    expect(screen.getByText('customer.apiKeys.neverUsedInline')).toBeInTheDocument();
    expect(await screen.findByText('customer.apiKeys.security.title')).toBeInTheDocument();
    expect(screen.getAllByText('customer.apiKeys.defaultScopeLabel')).toHaveLength(2);
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Revoked')).toBeInTheDocument();
    expect(screen.getByText((content) => content.startsWith('customer.apiKeys.statusSummary.ACTIVE'))).toBeInTheDocument();
    expect(screen.getByText((content) => content.startsWith('customer.apiKeys.statusSummary.INACTIVE'))).toBeInTheDocument();
    expect(spy.mock.calls.some((c) => String(c[0]).startsWith('/api/api-keys?'))).toBe(true);
  });

  it('renders an actionable empty state without faking rows', async () => {
    const spy = vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      if (path === '/api/auth/me') return Promise.resolve(CURRENT_USER);
      return Promise.resolve({ page: 1, pageSize: 20, total: 0, items: [] });
    });

    renderWithQuery(<CustomerApiKeyListFeature />);

    expect(await screen.findByText('customer.apiKeys.emptyState.title')).toBeInTheDocument();
    expect(screen.getByText('customer.apiKeys.emptyState.description')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'customer.apiKeys.emptyState.action' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(spy.mock.calls.some((c) => String(c[0]).startsWith('/api/api-keys?'))).toBe(true);
    expect(screen.queryByText('abcd1234')).not.toBeInTheDocument();
  });

  it('shows the one-time plainKey after a successful create with injected tenantId', async () => {
    let createBody: Record<string, unknown> | undefined;
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, init) => {
      if (path === '/api/auth/me') return Promise.resolve(CURRENT_USER);
      if (path === '/api/api-keys' && init?.method === 'POST') {
        createBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return Promise.resolve({ ...apiKeyRow(), plainKey: 'plain-secret-key' });
      }
      return Promise.resolve({ page: 1, pageSize: 20, total: 0, items: [] });
    });

    renderWithQuery(<CustomerApiKeyListFeature />);

    fireEvent.click(await screen.findByRole('button', { name: 'customer.apiKeys.create' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('customer.apiKeys.form.dedicatedPermissionPreview')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('customer.apiKeys.form.name'), {
      target: { value: 'Order automation' },
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'customer.apiKeys.form.submit' }));

    await waitFor(() => expect(createBody).toMatchObject({
      tenantId: 'tenant-1',
      name: 'Order automation',
      scopes: ['dedicated:*'],
      ipWhitelist: [],
    }));
    expect(await screen.findByText('plain-secret-key')).toBeInTheDocument();
    expect(screen.getByText('customer.apiKeys.plainKeyModal.createdNotice')).toBeInTheDocument();
  });

  it('revokes a key only after confirmation, then invalidates the api-keys query', async () => {
    let deleteCalled = false;
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, init) => {
      if (path === '/api/auth/me') return Promise.resolve(CURRENT_USER);
      if (path === '/api/api-keys/key-1' && init?.method === 'DELETE') {
        deleteCalled = true;
        return Promise.resolve(undefined);
      }
      return Promise.resolve({ page: 1, pageSize: 20, total: 1, items: [apiKeyRow()] });
    });

    const { queryClient } = renderWithQuery(<CustomerApiKeyListFeature />);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await screen.findByText('abcd1234');
    fireEvent.click(screen.getByRole('button', { name: 'customer.apiKeys.revoke' }));

    // delete must not fire before confirming the Popconfirm
    expect(deleteCalled).toBe(false);

    const confirmButtons = await screen.findAllByRole('button', { name: 'customer.apiKeys.revoke' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    await waitFor(() => expect(deleteCalled).toBe(true));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['api-keys'] }),
    );
  });

  it('shows the backend reasonKey when revoke fails', async () => {
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, init) => {
      if (path === '/api/auth/me') return Promise.resolve(CURRENT_USER);
      if (path === '/api/api-keys/key-1' && init?.method === 'DELETE') {
        return Promise.reject(new client.ApiError('NOT_FOUND', 'api_key_not_found'));
      }
      return Promise.resolve({ page: 1, pageSize: 20, total: 1, items: [apiKeyRow()] });
    });

    renderWithQuery(<CustomerApiKeyListFeature />);

    await screen.findByText('abcd1234');
    fireEvent.click(screen.getByRole('button', { name: 'customer.apiKeys.revoke' }));
    const confirmButtons = await screen.findAllByRole('button', { name: 'customer.apiKeys.revoke' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    expect(await screen.findByText('API key was not found')).toBeInTheDocument();
  });
});
