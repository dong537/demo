import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as client from '../../shared/api/client';
import { buildLineLimitsBody, LineLimitsPanel } from './line-limits.feature';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => ({
    'adminControlPlane.customer': 'Customer',
    'adminControlPlane.line': 'Line',
    'adminControlPlane.status': 'Status',
    'adminControlPlane.projections': 'Projections',
    'adminControlPlane.trafficQuota': 'Traffic quota',
    'adminControlPlane.bandwidthLimits': 'Uplink / downlink',
    'adminControlPlane.connectionLimits': 'Connections / IPs',
    'adminControlPlane.actions': 'Actions',
    'adminControlPlane.editLimits': 'Edit',
    'adminControlPlane.editLimitsTitle': 'Edit line limits',
    'adminControlPlane.trafficLimitBytes': 'Traffic limit',
    'adminControlPlane.uplinkLimitBps': 'Uplink limit',
    'adminControlPlane.downlinkLimitBps': 'Downlink limit',
    'adminControlPlane.maxConnections': 'Maximum connections',
    'adminControlPlane.ipLimit': 'Maximum IPs',
    'adminControlPlane.reason': 'Change reason',
    'adminControlPlane.zeroMeansUnlimited': '0 means unlimited',
    'adminControlPlane.unlimited': 'Unlimited',
    'adminControlPlane.linesTitle': 'Customer limits',
    confirm: 'Confirm',
    cancel: 'Cancel',
  }[key] ?? key) }),
}));

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><LineLimitsPanel /></QueryClientProvider>);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client, 'apiRequest').mockImplementation(async (path: string) => {
    if (path === '/api/admin/control-plane/lines?page=1&pageSize=20') {
      return {
        page: 1,
        pageSize: 20,
        total: 1,
        items: [{
          id: 'line-1', tenantId: 'tenant-1', userId: 'user-1', status: 'ACTIVE', countryCode: 'HK', protocol: 'VLESS', desiredVersion: 1,
          customer: { email: 'customer@example.com', name: 'Customer' },
          sku: { code: 'SV', name: 'Short video' },
          inboundTag: 'sv-hk-1',
          limits: { trafficLimitBytes: '10000', uplinkLimitBps: '131072', downlinkLimitBps: '524288', maxConnections: 32, ipLimit: 2 },
          projections: { ready: 2, total: 2 },
        }],
      } as never;
    }
    if (path === '/api/admin/control-plane/lines/line-1/limits') return {} as never;
    throw new Error(`unexpected request ${path}`);
  });
});

describe('dedicated line limits request contract', () => {
  it('builds a complete replacement payload with explicit units and a trimmed reason', () => {
    expect(buildLineLimitsBody({
      trafficLimitBytes: 10_000,
      uplinkLimitBps: 131_072,
      downlinkLimitBps: 524_288,
      maxConnections: 32,
      ipLimit: 2,
      reason: '  customer plan limits  ',
    })).toEqual({
      trafficLimitBytes: 10_000,
      uplinkLimitBps: 131_072,
      downlinkLimitBps: 524_288,
      maxConnections: 32,
      ipLimit: 2,
      reason: 'customer plan limits',
    });
  });

  it('loads a paginated line list and submits a complete audited limit replacement', async () => {
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /Edit/i }));
    fireEvent.change(screen.getByLabelText('Change reason'), { target: { value: 'customer plan change' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(client.apiRequest).toHaveBeenCalledWith('/api/admin/control-plane/lines/line-1/limits', {
        method: 'PUT',
        body: JSON.stringify({
          trafficLimitBytes: 10000,
          uplinkLimitBps: 131072,
          downlinkLimitBps: 524288,
          maxConnections: 32,
          ipLimit: 2,
          reason: 'customer plan change',
        }),
      });
    });
  });
});
