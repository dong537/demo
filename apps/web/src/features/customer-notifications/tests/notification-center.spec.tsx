import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  buildNotificationListPath,
  buildUnreadCountPath,
  buildMarkReadPath,
  buildMarkAllReadPath,
  NotificationCenter,
} from '../notification-center.feature';
import * as client from '../../../shared/api/client';

const navigateMock = vi.fn();
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { queryClient, ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) };
}

function notif(overrides: Record<string, unknown> = {}) {
  return {
    id: 'notif-1',
    type: 'ticket_reply',
    title: 'cannot connect',
    body: 'we replied',
    relatedType: 'ticket',
    relatedId: 'ticket-1',
    readAt: null,
    createdAt: '2026-06-09T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  navigateMock.mockReset();
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration));
});

describe('notification center contracts', () => {
  it('builds the real notification endpoints', () => {
    expect(buildNotificationListPath(1, 20)).toBe('/api/notifications?page=1&pageSize=20');
    expect(buildUnreadCountPath()).toBe('/api/notifications/unread-count');
    expect(buildMarkReadPath('n 1')).toBe('/api/notifications/n%201/read');
    expect(buildMarkAllReadPath()).toBe('/api/notifications/read-all');
  });

  it('renders the unread badge count from GET unread-count', async () => {
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      if (path === buildUnreadCountPath()) return Promise.resolve({ count: 3 });
      return Promise.resolve({ page: 1, pageSize: 20, total: 0, items: [] });
    });

    renderWithQuery(<NotificationCenter />);

    expect(await screen.findByText('3')).toBeInTheDocument();
  });

  it('loads the list on open and marks one read + navigates to the related ticket', async () => {
    let markReadCalled = false;
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, init) => {
      if (path === buildUnreadCountPath()) return Promise.resolve({ count: 1 });
      if (path === buildMarkReadPath('notif-1') && init?.method === 'POST') {
        markReadCalled = true;
        return Promise.resolve(undefined);
      }
      if (String(path).startsWith('/api/notifications?')) {
        return Promise.resolve({ page: 1, pageSize: 20, total: 1, items: [notif()] });
      }
      return Promise.resolve({ page: 1, pageSize: 20, total: 0, items: [] });
    });

    const { queryClient } = renderWithQuery(<NotificationCenter />);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    fireEvent.click(await screen.findByRole('button', { name: 'customer.notifications.bell' }));

    fireEvent.click(await screen.findByText('cannot connect'));

    await waitFor(() => expect(markReadCalled).toBe(true));
    expect(navigateMock).toHaveBeenCalledWith({ to: '/tickets/ticket-1' });
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['notifications', 'unread-count'] }),
    );
  });

  it('keeps the backend reasonKey visible and does not navigate when mark-read fails', async () => {
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, init) => {
      if (path === buildUnreadCountPath()) return Promise.resolve({ count: 1 });
      if (path === buildMarkReadPath('notif-1') && init?.method === 'POST') {
        return Promise.reject(new client.ApiError('SERVICE_UNAVAILABLE', 'mark_read_failed'));
      }
      if (String(path).startsWith('/api/notifications?')) {
        return Promise.resolve({ page: 1, pageSize: 20, total: 1, items: [notif()] });
      }
      return Promise.resolve({ page: 1, pageSize: 20, total: 0, items: [] });
    });

    renderWithQuery(<NotificationCenter />);
    fireEvent.click(await screen.findByRole('button', { name: 'customer.notifications.bell' }));
    fireEvent.click(await screen.findByText('cannot connect'));

    expect(await screen.findByText('mark_read_failed')).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('marks all read and invalidates the queries', async () => {
    let markAllCalled = false;
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, init) => {
      if (path === buildUnreadCountPath()) return Promise.resolve({ count: 2 });
      if (path === buildMarkAllReadPath() && init?.method === 'POST') {
        markAllCalled = true;
        return Promise.resolve(undefined);
      }
      if (String(path).startsWith('/api/notifications?')) {
        return Promise.resolve({ page: 1, pageSize: 20, total: 1, items: [notif()] });
      }
      return Promise.resolve({ page: 1, pageSize: 20, total: 0, items: [] });
    });

    const { queryClient } = renderWithQuery(<NotificationCenter />);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    fireEvent.click(await screen.findByRole('button', { name: 'customer.notifications.bell' }));
    fireEvent.click(await screen.findByRole('button', { name: 'customer.notifications.markAll' }));

    await waitFor(() => expect(markAllCalled).toBe(true));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['notifications', 'list'] }),
    );
  });

  it('shows an empty state when there are no notifications', async () => {
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      if (path === buildUnreadCountPath()) return Promise.resolve({ count: 0 });
      return Promise.resolve({ page: 1, pageSize: 20, total: 0, items: [] });
    });

    renderWithQuery(<NotificationCenter />);
    fireEvent.click(await screen.findByRole('button', { name: 'customer.notifications.bell' }));

    expect(await screen.findByText('customer.notifications.empty')).toBeInTheDocument();
  });

  it('shows the backend reasonKey when the list fails to load', async () => {
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      if (path === buildUnreadCountPath()) return Promise.resolve({ count: 0 });
      return Promise.reject(new client.ApiError('PERMISSION_DENIED', 'insufficient_permissions'));
    });

    renderWithQuery(<NotificationCenter />);
    fireEvent.click(await screen.findByRole('button', { name: 'customer.notifications.bell' }));

    expect(await screen.findByText('insufficient_permissions')).toBeInTheDocument();
  });

  it('does not display unread count as zero when unread-count fails', async () => {
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      if (path === buildUnreadCountPath()) {
        return Promise.reject(new client.ApiError('SERVICE_UNAVAILABLE', 'notifications_unavailable'));
      }
      return Promise.resolve({ page: 1, pageSize: 20, total: 1, items: [notif({ readAt: '2026-06-09T00:00:00.000Z' })] });
    });

    renderWithQuery(<NotificationCenter />);

    fireEvent.click(await screen.findByRole('button', { name: 'customer.notifications.bell' }));
    expect(await screen.findByText('notifications_unavailable')).toBeInTheDocument();
    expect(screen.queryByText('0', { selector: '.ant-badge-count' })).not.toBeInTheDocument();
  });

  it('does not display loaded count as zero when the notification list fails', async () => {
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      if (path === buildUnreadCountPath()) return Promise.resolve({ count: 1 });
      return Promise.reject(new client.ApiError('SERVICE_UNAVAILABLE', 'notification_list_failed'));
    });

    renderWithQuery(<NotificationCenter />);
    fireEvent.click(await screen.findByRole('button', { name: 'customer.notifications.bell' }));

    expect(await screen.findByText('notification_list_failed')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
