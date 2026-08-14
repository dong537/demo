import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UpstreamListFeature } from '../upstream-list.feature';
import * as client from '../../../shared/api/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function upstreamListResponse() {
  return {
    page: 1,
    pageSize: 20,
    total: 1,
    items: [
      {
        id: 'upstream-account-1',
        tenantId: 'tenant-1',
        name: 'Tenant upstream',
        baseUrl: 'https://upstream.example.com',
        status: 'ACTIVE',
        timeoutMs: 15000,
        inventorySyncEnabled: true,
        createdAt: '2026-06-11T00:00:00.000Z',
        updatedAt: '2026-06-11T00:00:00.000Z',
      },
    ],
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration));
});

describe('UpstreamListFeature', () => {
  it('updates an upstream account and syncs the current upstream resources', async () => {
    const spy = vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (String(path).startsWith('/api/upstream-accounts?')) return Promise.resolve(upstreamListResponse());
      if (path === '/api/upstream-accounts/upstream-account-1' && init?.method === 'PUT') {
        return Promise.resolve({
          ...upstreamListResponse().items[0],
          baseUrl: 'https://upstream.example.com',
          inventorySyncEnabled: true,
        });
      }
      if (path === '/api/upstream-accounts/upstream-account-1/sync-inventory' && init?.method === 'POST') {
        return Promise.resolve({
          attempted: 1,
          created: 1,
          updated: 0,
          skipped: 0,
          failed: 0,
          synced: 1,
          syncedAt: '2026-06-13T00:00:00.000Z',
          upstreamRawStatus: 'SUCCESS',
          countries: ['SG'],
        });
      }
      return Promise.resolve({});
    });

    renderWithQuery(<UpstreamListFeature />);
    await screen.findByText('Tenant upstream');

    fireEvent.click(screen.getByRole('button', { name: /upstream.operations.more/ }));
    fireEvent.click(await screen.findByText('upstream.edit'));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    await vi.waitFor(() => expect(
      spy.mock.calls.some(
        (call) => call[0] === '/api/upstream-accounts/upstream-account-1' && call[1]?.method === 'PUT',
      ),
    ).toBe(true));
    expect(spy.mock.calls.some(
      (call) => call[0] === '/api/upstream-accounts/upstream-account-1/sync-inventory' && call[1]?.method === 'POST',
    )).toBe(true);
    const updateCall = spy.mock.calls.find(
      (call) => call[0] === '/api/upstream-accounts/upstream-account-1' && call[1]?.method === 'PUT',
    );
    expect(String(updateCall?.[1]?.body)).not.toContain('apiKey');
  });

  it('renders the full auditable upstream inventory sync result', async () => {
    const spy = vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (String(path).startsWith('/api/upstream-accounts?')) return Promise.resolve(upstreamListResponse());
      if (path === '/api/upstream-accounts/upstream-account-1/sync-inventory' && init?.method === 'POST') {
        return Promise.resolve({
          attempted: 5,
          created: 2,
          updated: 1,
          skipped: 2,
          failed: 0,
          synced: 3,
          syncedAt: '2026-06-13T00:00:00.000Z',
          upstreamRawStatus: 'SUCCESS',
          countries: ['US', 'SG'],
        });
      }
      return Promise.resolve({});
    });

    renderWithQuery(<UpstreamListFeature />);
    await screen.findByText('Tenant upstream');

    fireEvent.click(screen.getByRole('button', { name: /upstream.operations.more/ }));
    fireEvent.click(await screen.findByText('upstream.sync'));

    await vi.waitFor(() => expect(
      spy.mock.calls.some(
        (call) => call[0] === '/api/upstream-accounts/upstream-account-1/sync-inventory' && call[1]?.method === 'POST',
      ),
    ).toBe(true));
    expect(await screen.findByText('resources.syncAttempted')).toBeInTheDocument();
    expect(screen.getByText('pricing.matrix.syncStatusReady')).toBeInTheDocument();
    expect(screen.getByText('resources.syncCountries')).toBeInTheDocument();
  });

  it('surfaces inventory sync failures from upstream accounts', async () => {
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (String(path).startsWith('/api/upstream-accounts?')) return Promise.resolve(upstreamListResponse());
      if (path === '/api/upstream-accounts/upstream-account-1/sync-inventory' && init?.method === 'POST') {
        return Promise.reject(new client.ApiError('UPSTREAM_ERROR', 'inventory_empty'));
      }
      return Promise.resolve({});
    });

    renderWithQuery(<UpstreamListFeature />);
    await screen.findByText('Tenant upstream');

    fireEvent.click(screen.getByRole('button', { name: /upstream.operations.more/ }));
    fireEvent.click(await screen.findByText('upstream.sync'));

    await vi.waitFor(() => expect(document.body.textContent).toContain('providers.reason.generic'));
    expect(document.body.textContent).not.toContain('inventory_empty');
    expect(screen.queryByText('resources.syncAttempted')).not.toBeInTheDocument();
  });

  it('shows a failed upstream test when the backend probe returns healthy=false', async () => {
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      if (String(path).startsWith('/api/upstream-accounts?')) return Promise.resolve(upstreamListResponse());
      if (path === '/api/upstream-accounts/upstream-account-1/test' && init?.method === 'POST') {
        return Promise.resolve({ healthy: false, latencyMs: 18, error: 'upstream_error' });
      }
      return Promise.resolve({});
    });

    renderWithQuery(<UpstreamListFeature />);
    await screen.findByText('Tenant upstream');

    fireEvent.click(screen.getByRole('button', { name: /upstream.operations.more/ }));
    fireEvent.click(await screen.findByText('upstream.test'));

    expect(await screen.findByText('providers.reason.generic')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('upstream_error');
    expect(screen.queryByText('upstream.testSuccess')).not.toBeInTheDocument();
  });
});
