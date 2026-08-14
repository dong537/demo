import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  buildProxyListPath,
  buildProxyCheckBody,
  formatProxyCheckFailure,
  getProxyCheckStepStatus,
  isCheckableProxy,
  reasonText,
  CustomerProxyCheckFeature,
} from '../proxy-check.feature';
import * as client from '../../../shared/api/client';
import { formatIpTypeZh, formatProtocolZh, formatResourceLocationZh } from '../../../shared/resource/resource-labels';
import { formatCustomerChannelLabel, formatProviderLabel } from '../../../shared/provider/provider-labels';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'customer.proxyCheck.reason.proxy_unreachable': '代理暂时无法连接',
        'customer.proxyCheck.reason.proxy_not_found': '代理不存在',
        'customer.proxyCheck.reason.proxy_check_failed': '代理检测失败，请稍后重试',
      };
      return translations[key] ?? (vars ? `${key}:${JSON.stringify(vars)}` : key);
    },
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { queryClient, ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) };
}

function proxyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proxy-1',
    ip: '203.0.113.10',
    port: 8080,
    countryCode: 'US',
    protocol: 'HTTP',
    status: 'ACTIVE',
    providerCode: 'PR',
    regionCode: 'US:USACALLAX',
    ipType: 'NATIVE',
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration));
});

describe('customer proxy-check feature contracts', () => {
  it('builds the active-proxy list path and the check body', () => {
    expect(buildProxyListPath()).toBe('/api/proxies?page=1&pageSize=20');
    expect(buildProxyCheckBody('proxy-1')).toEqual({ proxyId: 'proxy-1' });
  });

  it('treats only connectable proxy statuses as checkable', () => {
    expect(isCheckableProxy(proxyRow({ status: 'ACTIVE' }))).toBe(true);
    expect(isCheckableProxy(proxyRow({ status: 'EXPIRING' }))).toBe(true);
    expect(isCheckableProxy(proxyRow({ status: 'EXPIRED' }))).toBe(false);
    expect(isCheckableProxy(proxyRow({ status: 'DELIVERING' }))).toBe(false);
  });

  it('maps known reasonKeys to localized text and hides unknown backend keys', () => {
    const t = (key: string) => key;
    expect(reasonText((key) => (key === 'customer.proxyCheck.reason.proxy_unreachable' ? '代理暂时无法连接' : key), 'proxy_unreachable')).toBe('代理暂时无法连接');
    expect(reasonText(t, 'something_else')).toBe('customer.proxyCheck.reason.proxy_check_failed');
    expect(formatProxyCheckFailure((key) => (key === 'customer.proxyCheck.reason.proxy_unreachable' ? '代理暂时无法连接' : key), { reasonKey: 'proxy_unreachable', code: 'PROXY_UNREACHABLE' }))
      .toBe('代理暂时无法连接');
  });

  it('derives the visible step position from selection, running, and result state', () => {
    expect(getProxyCheckStepStatus(false, false, null, null)).toBe(0);
    expect(getProxyCheckStepStatus(true, false, null, null)).toBe(1);
    expect(getProxyCheckStepStatus(true, true, null, null)).toBe(1);
    expect(getProxyCheckStepStatus(true, false, { reachable: true }, null)).toBe(2);
    expect(getProxyCheckStepStatus(true, false, null, { reasonKey: 'proxy_not_found' })).toBe(2);
  });

  it('shows an empty state with a buy link when the user has no proxies', async () => {
    vi.spyOn(client, 'userApiRequest').mockResolvedValue({ page: 1, pageSize: 20, total: 0, items: [] });

    renderWithQuery(<CustomerProxyCheckFeature />);

    expect(await screen.findByText('customer.proxyCheck.empty')).toBeInTheDocument();
    expect(screen.getByText('customer.proxyCheck.goBuy')).toBeInTheDocument();
  });

  it('shows a clear state when proxies exist but none can be checked', async () => {
    vi.spyOn(client, 'userApiRequest').mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 1,
      items: [proxyRow({ status: 'EXPIRED' })],
    });

    renderWithQuery(<CustomerProxyCheckFeature />);

    expect(await screen.findByText('customer.proxyCheck.noCheckableProxies')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('filters the proxy selector to active or expiring proxies from the full proxy list', async () => {
    vi.spyOn(client, 'userApiRequest').mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 2,
      items: [
        proxyRow({ id: 'proxy-expired', ip: '203.0.113.20', status: 'EXPIRED' }),
        proxyRow({ id: 'proxy-active', ip: '203.0.113.10', status: 'ACTIVE' }),
      ],
    });

    renderWithQuery(<CustomerProxyCheckFeature />);

    const select = await screen.findByRole('combobox');
    fireEvent.mouseDown(select);

    expect(await screen.findByText(/203\.0\.113\.10/)).toBeInTheDocument();
    expect(screen.queryByText(/203\.0\.113\.20/)).not.toBeInTheDocument();
  });

  it('checks a selected proxy through POST /api/proxy-check and shows reachable + latency + exitIp', async () => {
    let checkBody: Record<string, unknown> | undefined;
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, init) => {
      if (path === '/api/proxy-check' && init?.method === 'POST') {
        checkBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return Promise.resolve({ reachable: true, latencyMs: 142, exitIp: '198.51.100.5' });
      }
      return Promise.resolve({ page: 1, pageSize: 20, total: 1, items: [proxyRow()] });
    });

    renderWithQuery(<CustomerProxyCheckFeature />);

    const select = await screen.findByRole('combobox');
    expect(screen.getByText('customer.proxyCheck.steps.select')).toBeInTheDocument();
    expect(screen.getByText('customer.proxyCheck.steps.request')).toBeInTheDocument();
    expect(screen.getByText('customer.proxyCheck.steps.result')).toBeInTheDocument();
    fireEvent.mouseDown(select);
    const option = await screen.findByText(/customer\.proxyCheck\.proxyLabel/);
    fireEvent.click(option);

    expect(screen.getByText(formatCustomerChannelLabel('PR'))).toBeInTheDocument();
    expect(screen.queryByText(formatProviderLabel('PR'))).not.toBeInTheDocument();
    expect(screen.getByText(formatResourceLocationZh({ code: 'US:USACALLAX', countryCode: 'US' }).title)).toBeInTheDocument();
    expect(screen.getAllByText(formatProtocolZh('HTTP')).length).toBeGreaterThan(0);
    expect(screen.getByText(formatIpTypeZh('NATIVE'))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'customer.proxyCheck.run' }));

    await waitFor(() => expect(checkBody).toEqual({ proxyId: 'proxy-1' }));
    expect(await screen.findByText('customer.proxyCheck.resultReachableTitle')).toBeInTheDocument();
    expect(screen.getAllByText('customer.proxyCheck.reachable').length).toBeGreaterThan(0);
    expect(screen.getByText(/customer\.proxyCheck\.latencyValue/)).toBeInTheDocument();
    expect(screen.getByText('198.51.100.5')).toBeInTheDocument();
  });

  it('shows the failure reasonKey text when the proxy is unreachable', async () => {
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, init) => {
      if (path === '/api/proxy-check' && init?.method === 'POST') {
        return Promise.resolve({ reachable: false, error: { code: 'PROXY_UNREACHABLE', reasonKey: 'proxy_unreachable' } });
      }
      return Promise.resolve({ page: 1, pageSize: 20, total: 1, items: [proxyRow()] });
    });

    renderWithQuery(<CustomerProxyCheckFeature />);

    const select = await screen.findByRole('combobox');
    fireEvent.mouseDown(select);
    fireEvent.click(await screen.findByText(/customer\.proxyCheck\.proxyLabel/));
    fireEvent.click(screen.getByRole('button', { name: 'customer.proxyCheck.run' }));

    expect(await screen.findByText('customer.proxyCheck.resultUnreachableTitle')).toBeInTheDocument();
    expect(await screen.findByText('代理暂时无法连接')).toBeInTheDocument();
    expect(screen.queryByText(/PROXY_UNREACHABLE/)).not.toBeInTheDocument();
    expect(screen.getAllByText('customer.proxyCheck.unreachable').length).toBeGreaterThan(0);
  });

  it('surfaces the backend reasonKey when the request itself errors', async () => {
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, init) => {
      if (path === '/api/proxy-check' && init?.method === 'POST') {
        return Promise.reject(new client.ApiError('NOT_FOUND', 'proxy_not_found'));
      }
      return Promise.resolve({ page: 1, pageSize: 20, total: 1, items: [proxyRow()] });
    });

    renderWithQuery(<CustomerProxyCheckFeature />);

    const select = await screen.findByRole('combobox');
    fireEvent.mouseDown(select);
    fireEvent.click(await screen.findByText(/customer\.proxyCheck\.proxyLabel/));
    fireEvent.click(screen.getByRole('button', { name: 'customer.proxyCheck.run' }));

    expect((await screen.findAllByText('代理不存在')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/NOT_FOUND/)).not.toBeInTheDocument();
  });
});
