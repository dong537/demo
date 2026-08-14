import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { ErrorCode } from '../../../common/errors/error-codes';
import { TicketsRepository, Ticket, TicketWithMessages } from '../tickets.repository';
import { CreateTicketUseCase } from './create-ticket.use-case';
import { ListTicketsUseCase } from './list-tickets.use-case';
import { GetTicketUseCase } from './get-ticket.use-case';
import { ReplyTicketUseCase } from './reply-ticket.use-case';
import { CloseTicketUseCase } from './close-ticket.use-case';
import { AppError } from '../../../common/errors/app-error';

const auditCreate = vi.fn();
vi.mock('@ipeasy/db', () => ({
  prisma: {
    audit_logs: { create: (...args: unknown[]) => auditCreate(...args) },
  },
}));

function authContext(overrides: Partial<AuthenticatedContext> = {}): AuthenticatedContext {
  return {
    ownerId: 'user-1',
    ownerType: 'USER',
    siteId: 'site-1',
    tenantId: 'tenant-1',
    scopes: [],
    requestId: 'req-1',
    ...overrides,
  };
}

const now = new Date('2026-06-09T00:00:00.000Z');

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'ticket-1',
    siteId: 'site-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    subject: 'cannot connect',
    status: 'OPEN',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Ticket;
}

function ticketWithMessages(overrides: Partial<TicketWithMessages> = {}): TicketWithMessages {
  return {
    ...ticket(),
    messages: [
      {
        id: 'msg-1',
        ticketId: 'ticket-1',
        siteId: 'site-1',
        tenantId: 'tenant-1',
        authorType: 'USER',
        authorId: 'user-1',
        body: 'help',
        createdAt: now,
      },
    ],
    ...overrides,
  } as TicketWithMessages;
}

function repoMock() {
  const repo = {
    createWithFirstMessage: vi.fn<TicketsRepository['createWithFirstMessage']>(),
    listForOwner: vi.fn<TicketsRepository['listForOwner']>(),
    getOwnedWithMessages: vi.fn<TicketsRepository['getOwnedWithMessages']>(),
    getOwned: vi.fn<TicketsRepository['getOwned']>(),
    appendUserMessage: vi.fn<TicketsRepository['appendUserMessage']>(),
    close: vi.fn<TicketsRepository['close']>(),
  };
  return repo;
}

beforeEach(() => {
  auditCreate.mockReset();
  auditCreate.mockResolvedValue(undefined);
});

describe('CreateTicketUseCase', () => {
  it('creates a ticket with the first message and writes an audit log', async () => {
    const repo = repoMock();
    repo.createWithFirstMessage.mockResolvedValue(ticketWithMessages());
    const useCase = new CreateTicketUseCase(repo as unknown as TicketsRepository);

    const result = await useCase.execute(authContext(), { subject: ' subj ', body: ' hi ' });

    expect(repo.createWithFirstMessage).toHaveBeenCalledWith({
      siteId: 'site-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      subject: 'subj',
      body: 'hi',
    });
    expect(result.messages).toHaveLength(1);
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'ticket.create' }) }),
    );
  });

  it('rejects an empty subject with VALIDATION_ERROR/subject_required', async () => {
    const repo = repoMock();
    const useCase = new CreateTicketUseCase(repo as unknown as TicketsRepository);

    await expect(useCase.execute(authContext(), { subject: '   ', body: 'hi' })).rejects.toMatchObject(
      { code: ErrorCode.VALIDATION_ERROR, reasonKey: 'subject_required' },
    );
    expect(repo.createWithFirstMessage).not.toHaveBeenCalled();
  });

  it('rejects an empty body with VALIDATION_ERROR/body_required', async () => {
    const repo = repoMock();
    const useCase = new CreateTicketUseCase(repo as unknown as TicketsRepository);

    await expect(useCase.execute(authContext(), { subject: 'subj', body: '' })).rejects.toMatchObject(
      { code: ErrorCode.VALIDATION_ERROR, reasonKey: 'body_required' },
    );
  });

  it('rejects non-USER callers', async () => {
    const repo = repoMock();
    const useCase = new CreateTicketUseCase(repo as unknown as TicketsRepository);

    await expect(
      useCase.execute(authContext({ ownerType: 'TENANT_ADMIN' }), { subject: 's', body: 'b' }),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
  });
});

describe('ListTicketsUseCase', () => {
  it('scopes the query to owner/site/tenant', async () => {
    const repo = repoMock();
    repo.listForOwner.mockResolvedValue({ page: 1, pageSize: 20, total: 1, items: [ticket()] });
    const useCase = new ListTicketsUseCase(repo as unknown as TicketsRepository);

    const result = await useCase.execute(authContext(), { page: 1, pageSize: 20 });

    expect(repo.listForOwner).toHaveBeenCalledWith(
      { ownerId: 'user-1', siteId: 'site-1', tenantId: 'tenant-1' },
      { page: 1, pageSize: 20 },
    );
    expect(result.items[0]).toEqual({
      id: 'ticket-1',
      subject: 'cannot connect',
      status: 'OPEN',
      createdAt: now,
      updatedAt: now,
    });
  });
});

describe('GetTicketUseCase', () => {
  it('loads an owned ticket via the scoped repository lookup', async () => {
    const repo = repoMock();
    repo.getOwnedWithMessages.mockResolvedValue(ticketWithMessages());
    const useCase = new GetTicketUseCase(repo as unknown as TicketsRepository);

    const result = await useCase.execute(authContext(), 'ticket-1');

    expect(repo.getOwnedWithMessages).toHaveBeenCalledWith('ticket-1', {
      ownerId: 'user-1',
      siteId: 'site-1',
      tenantId: 'tenant-1',
    });
    expect(result.id).toBe('ticket-1');
  });

  it("propagates NOT_FOUND when the ticket is not the caller's", async () => {
    const repo = repoMock();
    repo.getOwnedWithMessages.mockRejectedValue(
      new AppError(ErrorCode.NOT_FOUND, 'ticket_not_found', 404),
    );
    const useCase = new GetTicketUseCase(repo as unknown as TicketsRepository);

    await expect(useCase.execute(authContext(), 'other')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      reasonKey: 'ticket_not_found',
    });
  });
});

describe('ReplyTicketUseCase', () => {
  it('appends a reply and writes an audit log', async () => {
    const repo = repoMock();
    repo.getOwned.mockResolvedValue(ticket());
    repo.getOwnedWithMessages.mockResolvedValue(ticketWithMessages());
    const useCase = new ReplyTicketUseCase(repo as unknown as TicketsRepository);

    await useCase.execute(authContext(), 'ticket-1', { body: ' please help ' });

    expect(repo.appendUserMessage).toHaveBeenCalledWith({
      ticketId: 'ticket-1',
      siteId: 'site-1',
      tenantId: 'tenant-1',
      authorId: 'user-1',
      body: 'please help',
    });
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'ticket.reply' }) }),
    );
  });

  it('rejects replies to a CLOSED ticket', async () => {
    const repo = repoMock();
    repo.getOwned.mockResolvedValue(ticket({ status: 'CLOSED' }));
    const useCase = new ReplyTicketUseCase(repo as unknown as TicketsRepository);

    await expect(
      useCase.execute(authContext(), 'ticket-1', { body: 'hi' }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, reasonKey: 'ticket_closed' });
    expect(repo.appendUserMessage).not.toHaveBeenCalled();
  });

  it('rejects an empty reply body', async () => {
    const repo = repoMock();
    const useCase = new ReplyTicketUseCase(repo as unknown as TicketsRepository);

    await expect(
      useCase.execute(authContext(), 'ticket-1', { body: '   ' }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, reasonKey: 'body_required' });
    expect(repo.getOwned).not.toHaveBeenCalled();
  });
});

describe('CloseTicketUseCase', () => {
  it('closes an open ticket and writes an audit log', async () => {
    const repo = repoMock();
    repo.getOwned.mockResolvedValue(ticket());
    repo.getOwnedWithMessages.mockResolvedValue(ticketWithMessages({ status: 'CLOSED' }));
    const useCase = new CloseTicketUseCase(repo as unknown as TicketsRepository);

    const result = await useCase.execute(authContext(), 'ticket-1');

    expect(repo.close).toHaveBeenCalledWith('ticket-1');
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'ticket.close' }) }),
    );
    expect(result.status).toBe('CLOSED');
  });

  it('is idempotent for an already closed ticket and does not re-audit', async () => {
    const repo = repoMock();
    repo.getOwned.mockResolvedValue(ticket({ status: 'CLOSED' }));
    repo.getOwnedWithMessages.mockResolvedValue(ticketWithMessages({ status: 'CLOSED' }));
    const useCase = new CloseTicketUseCase(repo as unknown as TicketsRepository);

    await useCase.execute(authContext(), 'ticket-1');

    expect(repo.close).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
