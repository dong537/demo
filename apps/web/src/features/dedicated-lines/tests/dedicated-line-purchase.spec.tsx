import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DedicatedLinePurchaseFeature } from '../dedicated-line-purchase.feature';
import { DedicatedLineListFeature } from '../dedicated-line-list.feature';
import * as client from '../../../shared/api/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const copy: Record<string, string> = {
        'customer.dedicatedLines.purchase.title': '专线下单',
        'customer.dedicatedLines.purchase.sku': '业务类型',
        'customer.dedicatedLines.purchase.country': '国家代码',
        'customer.dedicatedLines.purchase.quantity': '数量',
        'customer.dedicatedLines.purchase.duration': '期限（天）',
        'customer.dedicatedLines.purchase.quote': '预计金额',
        'customer.dedicatedLines.purchase.submit': '提交专线订单',
        'customer.dedicatedLines.purchase.queued': '订单已进入履约队列',
        'customer.dedicatedLines.purchase.viewLines': '查看我的专线',
        'customer.dedicatedLines.list.title': '我的专线',
        'customer.dedicatedLines.list.empty': '暂无专线',
        'customer.dedicatedLines.list.domain': '入口域名',
        'customer.dedicatedLines.list.client': '客户端身份',
        'customer.dedicatedLines.list.ready': '可用',
        'customer.dedicatedLines.status.ACTIVE': '正常',
        'customer.dedicatedLines.status.PROVISIONING': '部署中',
        'customer.dedicatedLines.status.QUEUED': '排队中',
        'customer.dedicatedLines.status.DEGRADED': '降级',
        'customer.dedicatedLines.status.MIGRATING_AWAITING_ROUTE_IMPORT': '等待线路入口',
        'customer.dedicatedLines.status.EXPIRED': '已过期',
        'error': '请求失败',
      };
      copy['customer.dedicatedLines.lifecycle.suspend'] = '暂停专线';
      copy['customer.dedicatedLines.lifecycle.resume'] = '恢复专线';
      copy['customer.dedicatedLines.lifecycle.pending'] = '处理中';
      const text = copy[key] ?? key;
      return values ? text.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? '')) : text;
    },
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client, 'userApiRequest').mockImplementation(async (path: string) => {
    if (path === '/api/catalog/skus') {
      return [
        { id: 'sku-sv', code: 'SV', name: '短视频专线', description: null, isActive: true, isVisible: true, contractVersion: 1, capabilities: { delivery: 'dedicated-line' } },
        { id: 'sku-zb', code: 'ZB', name: '直播专线', description: null, isActive: true, isVisible: true, contractVersion: 1, capabilities: { delivery: 'dedicated-line' } },
      ] as never;
    }
    if (path.startsWith('/api/catalog/quote')) return { skuCode: 'SV', durationDays: 30, quantity: 2, unitPrice: '10', totalPrice: '20', currency: 'CNY', priceSource: 'SITE_DEFAULT_TEMPLATE', contractVersion: 1 } as never;
    if (path === '/api/dedicated-line-orders') return { status: 'QUEUED', reservationId: 'reservation-1', jobId: 'job-1', skuCode: 'SV', countryCode: 'HK', quantity: 2, replayed: false } as never;
    if (path === '/api/dedicated-lines') return [{ id: 'line-1', status: 'ACTIVE', countryCode: 'HK', protocol: 'VLESS', expiresAt: '2026-09-10T00:00:00.000Z', inboundTag: 'sv-hk-1', limits: { trafficLimitBytes: '10000', uplinkLimitBps: '131072', downlinkLimitBps: '524288', maxConnections: 32, ipLimit: 2 }, projections: { ready: 2, total: 2 }, domains: [{ hostname: 'sv-1.365proxy.net', port: 60701, isPrimary: true }], client: { email: 'line@example.com', id: 'client-1' } }] as never;
    if (path === '/api/dedicated-lines/line-1/suspend') return { lineId: 'line-1', status: 'SUSPENDED', expiresAt: '2026-09-10T00:00:00.000Z', desiredVersion: 2, replayed: false } as never;
    throw new Error(`unexpected request ${path}`);
  });

});

describe('dedicated line lifecycle controls', () => {
  it('suspends an active line through the real lifecycle endpoint', async () => {
    renderWithQuery(<DedicatedLineListFeature />);

    expect(await screen.findByRole('button', { name: '暂停专线' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '暂停专线' }));

    await waitFor(() => {
      expect(client.userApiRequest).toHaveBeenCalledWith('/api/dedicated-lines/line-1/suspend', { method: 'POST' });
    });
  });

  it('does not expose suspension while a line is awaiting route migration', async () => {
    vi.mocked(client.userApiRequest).mockImplementation(async (path: string) => {
      if (path === '/api/dedicated-lines') {
        return [{ id: 'line-1', status: 'MIGRATING_AWAITING_ROUTE_IMPORT', countryCode: 'HK', protocol: 'VLESS', expiresAt: '2026-09-10T00:00:00.000Z', inboundTag: 'sv-hk-1', limits: { trafficLimitBytes: '0', uplinkLimitBps: '0', downlinkLimitBps: '0', maxConnections: 0, ipLimit: 0 }, projections: { ready: 1, total: 2 }, domains: [], client: null }] as never;
      }
      throw new Error(`unexpected request ${path}`);
    });

    renderWithQuery(<DedicatedLineListFeature />);

    expect(await screen.findByRole('button', { name: '暂停专线' })).toBeDisabled();
  });
});

describe('dedicated line customer workflow', () => {
  it('quotes SV/ZB and submits a real dedicated-line order without provider fields', async () => {
    renderWithQuery(<DedicatedLinePurchaseFeature />);

    expect(await screen.findByRole('heading', { name: '专线下单' })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '业务类型' }));
    expect((await screen.findAllByText('SV · 短视频专线')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('ZB · 直播专线')).length).toBeGreaterThan(0);
    expect(await screen.findByText('20.00 CNY')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '提交专线订单' }));

    await waitFor(() => {
      expect(client.userApiRequest).toHaveBeenCalledWith('/api/dedicated-line-orders', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('订单已进入履约队列')).toBeInTheDocument();
  });

  it('renders only front-door domains and client identity for ready lines', async () => {
    renderWithQuery(<DedicatedLineListFeature />);

    expect(await screen.findByRole('heading', { name: '我的专线' })).toBeInTheDocument();
    expect(screen.getAllByText((_, element) => element?.textContent?.includes('sv-1.365proxy.net:60701') ?? false).length).toBeGreaterThan(0);
    expect(screen.getByText('client-1')).toBeInTheDocument();
    expect(screen.getByText('131072 B/s / 524288 B/s')).toBeInTheDocument();
    expect(screen.getByText('32 / 2')).toBeInTheDocument();
    expect(screen.queryByText('providerAccountId')).not.toBeInTheDocument();
  });
});
