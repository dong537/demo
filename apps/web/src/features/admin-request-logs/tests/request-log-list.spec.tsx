import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  UpstreamRequestLogListFeature,
  buildUpstreamLogListPath,
} from '../request-log-list.feature';
import * as client from '../../../shared/api/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'requestLogs.reason.provider_down': '上游线路暂时不可用',
        'requestLogs.reason.generic': '请求失败，详情已记录',
        'requestLogs.errorCodeRecorded': '错误代码已记录',
        'requestLogs.summaryReason': '失败原因',
        'requestLogs.summaryKey.error': '错误',
      };
      return translations[key] ?? key;
    },
  }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function logRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'log-1',
    siteId: 'site-1',
    providerCode: 'IPIPD',
    upstreamAccountId: null,
    operation: 'buy',
    requestId: 'req-abcdef1234567890',
    durationMs: 120,
    status: 'SUCCESS',
    errorCode: null,
    requestSummary: { country: 'US' },
    responseSummary: { token: '[REDACTED]', stock: 10 },
    createdAt: '2026-06-08T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration));
});

describe('upstream request log list feature', () => {
  it('builds list path with only backend-supported query params', () => {
    expect(buildUpstreamLogListPath({ page: 1, pageSize: 20 })).toBe(
      '/api/upstream-request-logs?page=1&pageSize=20',
    );
    expect(
      buildUpstreamLogListPath({
        page: 2,
        pageSize: 20,
        providerCode: 'IPIPD',
        status: 'ERROR',
        from: '2026-06-01',
        to: '2026-07-01',
      }),
    ).toBe(
      '/api/upstream-request-logs?page=2&pageSize=20&providerCode=IPIPD&status=ERROR&from=2026-06-01&to=2026-07-01',
    );
  });

  it('renders rows and passes the status filter into the query', async () => {
    const spy = vi.spyOn(client, 'apiRequest').mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 1,
      items: [logRow()],
    });

    renderWithQuery(<UpstreamRequestLogListFeature />);
    await screen.findByText('buy');

    fireEvent.mouseDown(screen.getByText('requestLogs.statusFilter'));
    fireEvent.click(await screen.findByText('requestLogs.statusError'));

    await waitFor(() =>
      expect(spy.mock.calls.some((c) => String(c[0]).includes('status=ERROR'))).toBe(true),
    );
  });

  it('shows the stored (already redacted) response summary in the detail drawer', async () => {
    vi.spyOn(client, 'apiRequest').mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 1,
      items: [logRow()],
    });

    renderWithQuery(<UpstreamRequestLogListFeature />);
    await screen.findByText('buy');
    expect(screen.getByText('req-abcdef12...7890')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'requestLogs.view' }));

    expect(await screen.findByText('requestLogs.detailTitle')).toBeInTheDocument();
    expect(screen.getByText('req-abcdef1234567890')).toBeInTheDocument();
    expect(screen.getByText(/\[REDACTED\]/)).toBeInTheDocument();
  });

  it('shows readable failure reasons from log summaries in the table and detail drawer', async () => {
    vi.spyOn(client, 'apiRequest').mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 1,
      items: [logRow({
        status: 'ERROR',
        errorCode: 'UPSTREAM_ERROR',
        responseSummary: { error: { reasonKey: 'provider_down' } },
      })],
    });

    renderWithQuery(<UpstreamRequestLogListFeature />);

    expect(await screen.findByText('上游线路暂时不可用')).toBeInTheDocument();
    expect(screen.queryByText('reasonKey: provider_down')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'requestLogs.view' }));

    expect(await screen.findByText('requestLogs.detailTitle')).toBeInTheDocument();
    expect(screen.getAllByText('上游线路暂时不可用').length).toBeGreaterThan(0);
    expect(screen.queryByText('provider_down')).not.toBeInTheDocument();
  });

  it('shows a generic list error instead of the backend reasonKey', async () => {
    vi.spyOn(client, 'apiRequest').mockRejectedValue(
      new client.ApiError('PERMISSION_DENIED', 'insufficient_permissions'),
    );

    renderWithQuery(<UpstreamRequestLogListFeature />);

    expect(await screen.findByText('error')).toBeInTheDocument();
    expect(screen.queryByText('insufficient_permissions')).not.toBeInTheDocument();
  });
});
