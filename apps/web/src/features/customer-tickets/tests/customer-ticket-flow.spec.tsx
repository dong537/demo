import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  buildTicketListPath,
  buildCreateTicketBody,
  ticketStatusColor,
  CustomerTicketListFeature,
} from '../ticket-list.feature';
import {
  buildTicketDetailPath,
  buildTicketReplyPath,
  buildTicketClosePath,
  CustomerTicketDetailFeature,
} from '../ticket-detail.feature';
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

function ticketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    subject: 'cannot connect',
    status: 'OPEN',
    createdAt: '2026-06-09T00:00:00.000Z',
    updatedAt: '2026-06-09T00:00:00.000Z',
    ...overrides,
  };
}

function ticketDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    subject: 'cannot connect',
    status: 'OPEN',
    createdAt: '2026-06-09T00:00:00.000Z',
    updatedAt: '2026-06-09T00:00:00.000Z',
    messages: [
      {
        id: 'msg-1',
        authorType: 'USER',
        authorId: 'user-1',
        body: 'my proxy is down',
        createdAt: '2026-06-09T00:00:00.000Z',
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

describe('customer ticket list feature', () => {
  it('builds list, create-body, and detail paths against real endpoints', () => {
    expect(buildTicketListPath(1, 20)).toBe('/api/tickets?page=1&pageSize=20');
    expect(buildCreateTicketBody({ subject: 's', body: 'b' })).toEqual({ subject: 's', body: 'b' });
    expect(buildTicketDetailPath('t 1')).toBe('/api/tickets/t%201');
    expect(buildTicketReplyPath('t-1')).toBe('/api/tickets/t-1/messages');
    expect(buildTicketClosePath('t-1')).toBe('/api/tickets/t-1/close');
  });

  it('maps known and unknown ticket statuses to visible tag colors', () => {
    expect(ticketStatusColor('OPEN')).toBe('blue');
    expect(ticketStatusColor('PENDING')).toBe('gold');
    expect(ticketStatusColor('CLOSED')).toBe('default');
    expect(ticketStatusColor('ESCALATED')).toBe('processing');
  });

  it('lists tickets through GET /api/tickets', async () => {
    vi.spyOn(client, 'userApiRequest').mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 3,
      items: [
        ticketRow(),
        ticketRow({
          id: 'ticket-2',
          subject: 'waiting support',
          status: 'PENDING',
          lastMessage: {
            authorType: 'TENANT_ADMIN',
            body: 'please provide endpoint logs',
            createdAt: '2026-06-09T01:00:00.000Z',
          },
        }),
        ticketRow({ id: 'ticket-3', subject: 'resolved issue', status: 'CLOSED' }),
        ticketRow({ id: 'ticket-4', subject: 'provider handoff', status: 'ESCALATED' }),
      ],
    });

    renderWithQuery(<CustomerTicketListFeature />);

    expect(await screen.findByText('cannot connect')).toBeInTheDocument();
    expect(screen.getByText('waiting support')).toBeInTheDocument();
    expect(screen.getByText('resolved issue')).toBeInTheDocument();
    expect(screen.getByText('provider handoff')).toBeInTheDocument();
    expect(screen.getByText('please provide endpoint logs')).toBeInTheDocument();
    expect(screen.getAllByText('customer.tickets.noRecentReply')).toHaveLength(3);
    expect(screen.getAllByText('customer.tickets.ticketId')).toHaveLength(4);
    expect(screen.getByText('customer.tickets.metrics.totalDesc')).toBeInTheDocument();
    expect(screen.getByText('customer.tickets.metrics.currentPageDesc')).toBeInTheDocument();
    expect(screen.getByText('customer.tickets.metrics.activeBreakdown')).toBeInTheDocument();
    expect(screen.getAllByText(/customer\.tickets\.statusValue\./).length).toBeGreaterThanOrEqual(6);
    expect(screen.getByText('customer.tickets.statusValue.ESCALATED')).toBeInTheDocument();
  });

  it('renders a first-ticket empty state with the real create action', async () => {
    vi.spyOn(client, 'userApiRequest').mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 0,
      items: [],
    });

    renderWithQuery(<CustomerTicketListFeature />);

    expect(await screen.findByText('customer.tickets.emptyTitle')).toBeInTheDocument();
    expect(screen.getByText('customer.tickets.emptyDescription')).toBeInTheDocument();
    const createButtons = screen.getAllByRole('button', { name: 'customer.tickets.create' });
    fireEvent.click(createButtons[createButtons.length - 1]!);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('creates a ticket then navigates to its detail page', async () => {
    let createBody: Record<string, unknown> | undefined;
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, init) => {
      if (path === '/api/tickets' && init?.method === 'POST') {
        createBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return Promise.resolve(ticketRow());
      }
      return Promise.resolve({ page: 1, pageSize: 20, total: 0, items: [] });
    });

    renderWithQuery(<CustomerTicketListFeature />);

    fireEvent.click(await screen.findByRole('button', { name: 'customer.tickets.create' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'customer.tickets.form.subject' }), {
      target: { value: 'help me' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'customer.tickets.form.body' }), {
      target: { value: 'proxy down' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'customer.tickets.form.submit' }));

    await waitFor(() => expect(createBody).toEqual({ subject: 'help me', body: 'proxy down' }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/tickets/ticket-1' }));
  });

  it('keeps create-ticket backend reasonKey visible inside the modal', async () => {
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, init) => {
      if (path === '/api/tickets' && init?.method === 'POST') {
        return Promise.reject(new client.ApiError('VALIDATION_ERROR', 'ticket_body_too_long'));
      }
      return Promise.resolve({ page: 1, pageSize: 20, total: 0, items: [] });
    });

    renderWithQuery(<CustomerTicketListFeature />);

    fireEvent.click(await screen.findByRole('button', { name: 'customer.tickets.create' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'customer.tickets.form.subject' }), {
      target: { value: 'help me' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'customer.tickets.form.body' }), {
      target: { value: 'proxy down' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'customer.tickets.form.submit' }));

    expect(await within(dialog).findByText('ticket_body_too_long')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('customer ticket detail feature', () => {
  it('renders the message timeline', async () => {
    vi.spyOn(client, 'userApiRequest').mockResolvedValue(ticketDetail());

    renderWithQuery(<CustomerTicketDetailFeature ticketId="ticket-1" />);

    expect(await screen.findByText('my proxy is down')).toBeInTheDocument();
    expect(screen.getByText('customer.tickets.detailSummary')).toBeInTheDocument();
    expect(screen.getByText('customer.tickets.communicationState')).toBeInTheDocument();
  });

  it('submits a reply and invalidates the ticket query', async () => {
    let replyCalled = false;
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, init) => {
      if (path === '/api/tickets/ticket-1/messages' && init?.method === 'POST') {
        replyCalled = true;
        return Promise.resolve(ticketDetail());
      }
      return Promise.resolve(ticketDetail());
    });

    const { queryClient } = renderWithQuery(<CustomerTicketDetailFeature ticketId="ticket-1" />);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await screen.findByText('my proxy is down');
    fireEvent.change(screen.getByPlaceholderText('customer.tickets.form.bodyPlaceholder'), {
      target: { value: 'any update?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'customer.tickets.replySubmit' }));

    await waitFor(() => expect(replyCalled).toBe(true));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['ticket', 'ticket-1'] }),
    );
  });

  it('closes the ticket only after confirmation', async () => {
    let closeCalled = false;
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, init) => {
      if (path === '/api/tickets/ticket-1/close' && init?.method === 'POST') {
        closeCalled = true;
        return Promise.resolve(ticketDetail({ status: 'CLOSED' }));
      }
      return Promise.resolve(ticketDetail());
    });

    renderWithQuery(<CustomerTicketDetailFeature ticketId="ticket-1" />);

    await screen.findByText('my proxy is down');
    fireEvent.click(screen.getByRole('button', { name: 'customer.tickets.close' }));
    // close must not fire before confirming the Popconfirm
    expect(closeCalled).toBe(false);

    const confirmButtons = await screen.findAllByRole('button', { name: 'customer.tickets.close' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    await waitFor(() => expect(closeCalled).toBe(true));
  });

  it('shows the backend reasonKey when the ticket is not found', async () => {
    vi.spyOn(client, 'userApiRequest').mockRejectedValue(
      new client.ApiError('NOT_FOUND', 'ticket_not_found'),
    );

    renderWithQuery(<CustomerTicketDetailFeature ticketId="ticket-1" />);

    expect(await screen.findByText('ticket_not_found')).toBeInTheDocument();
  });
});
