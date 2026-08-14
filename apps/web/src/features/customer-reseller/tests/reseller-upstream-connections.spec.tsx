import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ResellerUpstreamConnectionsFeature, buildFederatedConnectionBody } from '../reseller-upstream-connections.feature';
import { userApiRequest } from '../../../shared/api/client';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../shared/api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../shared/api/client')>('../../../shared/api/client');
  return { ...actual, userApiRequest: vi.fn() };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(userApiRequest).mockImplementation(async (path, init) => {
    if (String(path).endsWith('/scan') && init?.method === 'POST') {
      return { connectionId: 'connection-1', balanceAmount: '88.5', balanceUnit: 'CNY', inventory: [], prices: [] };
    }
    if (path === '/api/customer/reseller/upstream-connections' && init?.method === 'POST') {
      return { id: 'connection-2' };
    }
    return {
      page: 1,
      pageSize: 20,
      total: 1,
      items: [{
        id: 'connection-1',
        kind: 'PLATFORM_365',
        name: 'Main 365 platform',
        baseUrl: 'https://upstream.example.com',
        status: 'ACTIVE',
        timeoutMs: 15000,
        credentialConfigured: true,
        credentialFingerprint: 'abcdef1234567890',
        lastScan: {
          status: 'SUCCESS',
          capturedAt: '2026-08-11T00:00:00.000Z',
          expiresAt: '2026-08-11T00:05:00.000Z',
          errorCode: null,
          balanceAmount: '88.5',
          balanceUnit: 'CNY',
          inventoryCount: 3,
          priceCount: 2,
        },
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
      }],
    };
  });
});

describe('ResellerUpstreamConnectionsFeature', () => {
  it('builds provider-specific credential payloads without adding hidden defaults', () => {
    expect(buildFederatedConnectionBody({
      kind: 'PLATFORM_365',
      name: ' Main ',
      baseUrl: ' https://upstream.example.com ',
      apiKey: ' key ',
    })).toEqual({
      kind: 'PLATFORM_365',
      name: 'Main',
      baseUrl: 'https://upstream.example.com',
      credentials: { apiKey: 'key' },
    });
    expect(buildFederatedConnectionBody({
      kind: 'IPIPD',
      name: ' IPIPD ',
      baseUrl: ' https://sandbox.ipipd.cn ',
      appId: ' app ',
      appSecret: ' secret ',
    })).toEqual({
      kind: 'IPIPD',
      name: 'IPIPD',
      baseUrl: 'https://sandbox.ipipd.cn',
      credentials: { appId: 'app', appSecret: 'secret' },
    });
  });

  it('lists sanitized connections and runs a real backend scan action', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><ResellerUpstreamConnectionsFeature /></QueryClientProvider>);

    expect(await screen.findByText('Main 365 platform')).toBeInTheDocument();
    expect(screen.getByText('customer.reseller.upstreams.balance')).toBeInTheDocument();
    expect(screen.getByText('customer.reseller.upstreams.scanCounts')).toBeInTheDocument();
    expect(screen.getByText('customer.reseller.upstreams.scanExpires')).toBeInTheDocument();
    expect(screen.queryByText('federation-secret-key')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /customer\.reseller\.upstreams\.scan$/ }));
    await waitFor(() => {
      expect(userApiRequest).toHaveBeenCalledWith('/api/customer/reseller/upstream-connections/connection-1/scan', { method: 'POST' });
    }, { timeout: 15000 });
  });

  it('submits a platform key through a password field and never renders it after save', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><ResellerUpstreamConnectionsFeature /></QueryClientProvider>);
    await screen.findByText('Main 365 platform');

    fireEvent.change(screen.getByLabelText('customer.reseller.upstreams.name'), { target: { value: 'Backup 365' } });
    fireEvent.change(screen.getByLabelText('customer.reseller.upstreams.baseUrl'), { target: { value: 'https://backup.example.com' } });
    fireEvent.change(screen.getByLabelText('customer.reseller.upstreams.apiKey'), { target: { value: 'new-secret-key' } });
    fireEvent.click(screen.getByRole('button', { name: /customer\.reseller\.upstreams\.save$/ }));

    await waitFor(() => {
      expect(userApiRequest).toHaveBeenCalledWith('/api/customer/reseller/upstream-connections', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'PLATFORM_365',
          name: 'Backup 365',
          baseUrl: 'https://backup.example.com',
          credentials: { apiKey: 'new-secret-key' },
        }),
      });
    }, { timeout: 15000 });
    expect(screen.queryByDisplayValue('new-secret-key')).not.toBeInTheDocument();
  }, 15000);
});
