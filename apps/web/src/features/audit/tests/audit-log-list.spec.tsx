import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuditLogListFeature } from '../audit-log-list.feature';
import * as client from '../../../shared/api/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function auditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'audit-1',
    action: 'order.refund',
    actorType: 'ADMIN_USER',
    actorId: 'admin-1234567890',
    targetType: 'ORDER',
    targetId: 'order-1234567890',
    requestId: 'req-abcdef1234567890',
    meta: { reasonKey: 'provider_down' },
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

describe('audit log list feature', () => {
  it('renders action, owner, target, requestId, reasonKey, and passes filters to /api/audit', async () => {
    const spy = vi.spyOn(client, 'apiRequest').mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 1,
      items: [auditRow()],
    });

    renderWithQuery(<AuditLogListFeature />);

    expect(await screen.findByText('order.refund')).toBeInTheDocument();
    expect(screen.getByText('ADMIN_USER')).toBeInTheDocument();
    expect(screen.getByText('admin-12...')).toBeInTheDocument();
    expect(screen.getByText('ORDER')).toBeInTheDocument();
    expect(screen.getByText('order-12...')).toBeInTheDocument();
    expect(screen.getByText('req-abcdef12...7890')).toBeInTheDocument();
    expect(screen.getByText('reasonKey: provider_down')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByText('audit.actorTypeFilter'));
    fireEvent.click(await screen.findByText('SYSTEM'));

    await waitFor(() =>
      expect(spy.mock.calls.some((c) => String(c[0]).includes('/api/audit?') && String(c[0]).includes('actorType=SYSTEM'))).toBe(true),
    );
  });

  it('shows backend reasonKey on list error', async () => {
    vi.spyOn(client, 'apiRequest').mockRejectedValue(
      new client.ApiError('PERMISSION_DENIED', 'insufficient_permissions'),
    );

    renderWithQuery(<AuditLogListFeature />);

    expect(await screen.findByText('insufficient_permissions')).toBeInTheDocument();
  });
});
