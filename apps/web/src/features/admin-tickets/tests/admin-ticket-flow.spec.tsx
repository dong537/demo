import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  AdminTicketListFeature,
  buildAdminTicketListPath,
} from '../ticket-list.feature';
import {
  AdminTicketDetailFeature,
  buildAdminTicketDetailPath,
  buildAdminTicketReplyPath,
  buildAdminTicketStatusPath,
} from '../ticket-detail.feature';
import * as client from '../../../shared/api/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const navigateMock = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function listItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    subject: 'cannot connect',
    status: 'OPEN',
    userId: 'user-1',
    userEmail: 'user@example.com',
    createdAt: '2026-06-08T00:00:00.000Z',
    updatedAt: '2026-06-09T00:00:00.000Z',
    ...overrides,
  };
}

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    subject: 'cannot connect',
    status: 'OPEN',
    userId: 'user-1',
    userEmail: 'user@example.com',
    createdAt: '2026-06-08T00:00:00.000Z',
    updatedAt: '2026-06-09T00:00:00.000Z',
    messages: [
      {
        id: 'm1',
        authorType: 'USER',
        authorId: 'user-1',
        body: 'help me',
        createdAt: '2026-06-08T00:00:00.000Z',
      },
      {
        id: 'm2',
        authorType: 'ADMIN_USER',
        authorId: 'admin-1',
        body: 'on it',
        createdAt: '2026-06-08T01:00:00.000Z',
      },
    ],
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

describe('admin ticket list feature', () => {
  it('builds list path with only backend-supported params', () => {
    expect(buildAdminTicketListPath({ page: 1, pageSize: 20 })).toBe(
      '/api/admin/tickets?page=1&pageSize=20',
    );
    expect(buildAdminTicketListPath({ page: 2, pageSize: 20, status: 'PENDING' })).toBe(
      '/api/admin/tickets?page=2&pageSize=20&status=PENDING',
    );
  });

  it('renders rows with the customer email and passes status filter into the query', async () => {
    const spy = vi.spyOn(client, 'apiRequest').mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 1,
      items: [listItem()],
    });

    renderWithQuery(<AdminTicketListFeature />);
    await screen.findByText('cannot connect');
    expect(screen.getByText('user@example.com')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByText('adminTickets.statusFilter'));
    fireEvent.click(await screen.findByText('adminTickets.statusValue.PENDING'));

    await waitFor(() =>
      expect(spy.mock.calls.some((c) => String(c[0]).includes('status=PENDING'))).toBe(true),
    );
  });

  it('shows the backend reasonKey on a permission error', async () => {
    vi.spyOn(client, 'apiRequest').mockRejectedValue(
      new client.ApiError('PERMISSION_DENIED', 'insufficient_permissions'),
    );

    renderWithQuery(<AdminTicketListFeature />);

    expect(await screen.findByText('insufficient_permissions')).toBeInTheDocument();
  });
});

describe('admin ticket detail feature', () => {
  it('builds the detail/reply/status paths', () => {
    expect(buildAdminTicketDetailPath('t1')).toBe('/api/admin/tickets/t1');
    expect(buildAdminTicketReplyPath('t1')).toBe('/api/admin/tickets/t1/messages');
    expect(buildAdminTicketStatusPath('t1')).toBe('/api/admin/tickets/t1/status');
  });

  it('distinguishes USER vs ADMIN_USER authors in the timeline', async () => {
    vi.spyOn(client, 'apiRequest').mockResolvedValue(detail());

    renderWithQuery(<AdminTicketDetailFeature ticketId="ticket-1" />);

    await screen.findByText('help me');
    expect(screen.getByText('adminTickets.authorUser')).toBeInTheDocument();
    expect(screen.getByText('adminTickets.authorAdmin')).toBeInTheDocument();
  });

  it('submits an admin reply to the messages endpoint', async () => {
    const spy = vi.spyOn(client, 'apiRequest').mockResolvedValue(detail());

    renderWithQuery(<AdminTicketDetailFeature ticketId="ticket-1" />);
    await screen.findByText('help me');

    const textarea = screen.getByPlaceholderText('adminTickets.replyPlaceholder');
    fireEvent.change(textarea, { target: { value: 'here is your fix' } });
    fireEvent.click(screen.getByRole('button', { name: 'adminTickets.replySubmit' }));

    await waitFor(() =>
      expect(
        spy.mock.calls.some(
          (c) => String(c[0]).endsWith('/messages') && (c[1] as RequestInit)?.method === 'POST',
        ),
      ).toBe(true),
    );
  });

  it('triggers a status change to PENDING', async () => {
    const spy = vi.spyOn(client, 'apiRequest').mockResolvedValue(detail());

    renderWithQuery(<AdminTicketDetailFeature ticketId="ticket-1" />);
    await screen.findByText('help me');

    expect(screen.queryByText('adminTickets.operations.more')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'adminTickets.markPending' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'adminTickets.markPending' }));

    await waitFor(() =>
      expect(
        spy.mock.calls.some((c) => {
          const init = c[1] as RequestInit | undefined;
          return (
            String(c[0]).endsWith('/status') &&
            init?.method === 'POST' &&
            String(init?.body).includes('PENDING')
          );
        }),
      ).toBe(true),
    );
  });

  it('renders real status and updated time in the detail summary', async () => {
    vi.spyOn(client, 'apiRequest').mockResolvedValue(detail({ status: 'PENDING' }));

    renderWithQuery(<AdminTicketDetailFeature ticketId="ticket-1" />);

    await screen.findByText('help me');
    expect(screen.getAllByText('adminTickets.statusValue.PENDING').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('adminTickets.updatedAt')).toBeInTheDocument();
  });

  it('shows the backend reasonKey when the reply fails', async () => {
    vi.spyOn(client, 'apiRequest')
      .mockResolvedValueOnce(detail())
      .mockRejectedValueOnce(new client.ApiError('NOT_FOUND', 'ticket_not_found'));

    renderWithQuery(<AdminTicketDetailFeature ticketId="ticket-1" />);
    await screen.findByText('help me');

    const textarea = screen.getByPlaceholderText('adminTickets.replyPlaceholder');
    fireEvent.change(textarea, { target: { value: 'reply text' } });
    fireEvent.click(screen.getByRole('button', { name: 'adminTickets.replySubmit' }));

    expect(await screen.findByText('ticket_not_found')).toBeInTheDocument();
  });
});
