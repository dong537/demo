import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { ErrorCode } from '../../../common/errors/error-codes';
import {
  TicketsRepository,
  TicketWithUser,
  TicketDetailWithUser,
} from '../tickets.repository';
import { ListAdminTicketsUseCase } from './list-admin-tickets.use-case';
import { GetAdminTicketUseCase } from './get-admin-ticket.use-case';
import { ReplyAdminTicketUseCase } from './reply-admin-ticket.use-case';
import { UpdateAdminTicketStatusUseCase } from './update-admin-ticket-status.use-case';
import { AppError } from '../../../common/errors/app-error';

const auditCreate = vi.fn();
vi.mock('@ipeasy/db', () => ({
  prisma: {
    audit_logs: { create: (...args: unknown[]) => auditCreate(...args) },
  },
}));

import { NotificationsRepository } from '../../notifications/notifications.repository';
import { LoggerService } from '../../../common/logging/logger.service';

function notificationsMock() {
  return { createForUser: vi.fn().mockResolvedValue(undefined) };
}

function loggerMock() {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
}

function adminContext(overrides: Partial<AuthenticatedContext> = {}): AuthenticatedContext {
  return {
    ownerId: 'admin-1',
    ownerType: 'PLATFORM_ADMIN',
    siteId: 'site-1',
    tenantId: null,
    scopes: [],
    requestId: 'req-1',
    ...overrides,
  };
}

const now = new Date('2026-06-09T00:00:00.000Z');

function listItem(overrides: Partial<TicketWithUser> = {}): TicketWithUser {
  return {
    id: 'ticket-1',
    siteId: 'site-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    subject: 'cannot connect',
    status: 'OPEN',
    createdAt: now,
    updatedAt: now,
    user: { id: 'user-1', email: 'user@example.com' },
    ...overrides,
  } as TicketWithUser;
}

function detail(overrides: Partial<TicketDetailWithUser> = {}): TicketDetailWithUser {
  return {
    ...listItem(),
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
  } as TicketDetailWithUser;
}

function repoMock() {
  return {
    listForScope: vi.fn<TicketsRepository['listForScope']>(),
    getForScope: vi.fn<TicketsRepository['getForScope']>(),
    appendAdminMessage: vi.fn<TicketsRepository['appendAdminMessage']>(),
    updateStatus: vi.fn<TicketsRepository['updateStatus']>(),
  };
}

beforeEach(() => {
  auditCreate.mockReset();
  auditCreate.mockResolvedValue(undefined);
});

describe('ListAdminTicketsUseCase', () => {
  it('PLATFORM_ADMIN lists the whole site (tenantId=null)', async () => {
    const repo = repoMock();
    repo.listForScope.mockResolvedValue({ page: 1, pageSize: 20, total: 1, items: [listItem()] });
    const useCase = new ListAdminTicketsUseCase(repo as unknown as TicketsRepository);

    const result = await useCase.execute(adminContext(), { page: 1, pageSize: 20, status: 'OPEN' });

    expect(repo.listForScope).toHaveBeenCalledWith(
      { siteId: 'site-1', tenantId: null },
      { page: 1, pageSize: 20, status: 'OPEN' },
    );
    expect(result.items[0]).toEqual({
      id: 'ticket-1',
      subject: 'cannot connect',
      status: 'OPEN',
      userId: 'user-1',
      userEmail: 'user@example.com',
      createdAt: now,
      updatedAt: now,
    });
  });

  it('TENANT_ADMIN is locked to its own tenant', async () => {
    const repo = repoMock();
    repo.listForScope.mockResolvedValue({ page: 1, pageSize: 20, total: 0, items: [] });
    const useCase = new ListAdminTicketsUseCase(repo as unknown as TicketsRepository);

    await useCase.execute(
      adminContext({ ownerType: 'TENANT_ADMIN', tenantId: 'tenant-1' }),
      { page: 1, pageSize: 20 },
    );

    expect(repo.listForScope).toHaveBeenCalledWith(
      { siteId: 'site-1', tenantId: 'tenant-1' },
      { page: 1, pageSize: 20 },
    );
  });

  it('rejects USER callers with PERMISSION_DENIED', async () => {
    const repo = repoMock();
    const useCase = new ListAdminTicketsUseCase(repo as unknown as TicketsRepository);

    await expect(
      useCase.execute(adminContext({ ownerType: 'USER', tenantId: 'tenant-1' }), { page: 1, pageSize: 20 }),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
    expect(repo.listForScope).not.toHaveBeenCalled();
  });

  it('rejects TENANT_ADMIN without a tenant context', async () => {
    const repo = repoMock();
    const useCase = new ListAdminTicketsUseCase(repo as unknown as TicketsRepository);

    await expect(
      useCase.execute(adminContext({ ownerType: 'TENANT_ADMIN', tenantId: null }), { page: 1, pageSize: 20 }),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED, reasonKey: 'tenant_context_required' });
  });
});

describe('GetAdminTicketUseCase', () => {
  it('loads a ticket within scope with customer email', async () => {
    const repo = repoMock();
    repo.getForScope.mockResolvedValue(detail());
    const useCase = new GetAdminTicketUseCase(repo as unknown as TicketsRepository);

    const result = await useCase.execute(adminContext(), 'ticket-1');

    expect(repo.getForScope).toHaveBeenCalledWith('ticket-1', { siteId: 'site-1', tenantId: null });
    expect(result.userEmail).toBe('user@example.com');
    expect(result.messages).toHaveLength(1);
  });

  it('propagates NOT_FOUND when the ticket is outside scope', async () => {
    const repo = repoMock();
    repo.getForScope.mockRejectedValue(new AppError(ErrorCode.NOT_FOUND, 'ticket_not_found', 404));
    const useCase = new GetAdminTicketUseCase(repo as unknown as TicketsRepository);

    await expect(useCase.execute(adminContext(), 'other')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      reasonKey: 'ticket_not_found',
    });
  });
});

describe('ReplyAdminTicketUseCase', () => {
  it('appends an ADMIN_USER message using the ticket tenant and audits', async () => {
    const repo = repoMock();
    repo.getForScope.mockResolvedValue(detail());
    const notifications = notificationsMock();
    const useCase = new ReplyAdminTicketUseCase(
      repo as unknown as TicketsRepository,
      notifications as unknown as NotificationsRepository,
      loggerMock() as unknown as LoggerService,
    );

    await useCase.execute(adminContext(), 'ticket-1', { body: ' on it ' });

    expect(repo.appendAdminMessage).toHaveBeenCalledWith({
      ticketId: 'ticket-1',
      siteId: 'site-1',
      tenantId: 'tenant-1',
      authorId: 'admin-1',
      body: 'on it',
      wasClosed: false,
    });
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'ticket.admin_reply', actorType: 'ADMIN_USER' }),
      }),
    );
  });

  it('produces one ticket_reply notification for the ticket owner using the ticket tenant', async () => {
    const repo = repoMock();
    repo.getForScope.mockResolvedValue(detail());
    const notifications = notificationsMock();
    const useCase = new ReplyAdminTicketUseCase(
      repo as unknown as TicketsRepository,
      notifications as unknown as NotificationsRepository,
      loggerMock() as unknown as LoggerService,
    );

    await useCase.execute(adminContext(), 'ticket-1', { body: 'we are looking into it' });

    expect(notifications.createForUser).toHaveBeenCalledWith({
      siteId: 'site-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      type: 'ticket_reply',
      title: 'cannot connect',
      body: 'we are looking into it',
      relatedType: 'ticket',
      relatedId: 'ticket-1',
    });
  });

  it('does not fail the reply when the notification write throws (logged, not propagated)', async () => {
    const repo = repoMock();
    repo.getForScope.mockResolvedValue(detail());
    const notifications = notificationsMock();
    notifications.createForUser.mockRejectedValue(new Error('db down'));
    const logger = loggerMock();
    const useCase = new ReplyAdminTicketUseCase(
      repo as unknown as TicketsRepository,
      notifications as unknown as NotificationsRepository,
      logger as unknown as LoggerService,
    );

    const result = await useCase.execute(adminContext(), 'ticket-1', { body: 'still works' });

    expect(result.id).toBe('ticket-1');
    expect(logger.error).toHaveBeenCalledWith(
      'notification.ticket_reply.write_failed',
      expect.objectContaining({ ticketId: 'ticket-1', userId: 'user-1' }),
    );
  });

  it('flags wasClosed so a CLOSED ticket re-opens on admin reply', async () => {
    const repo = repoMock();
    repo.getForScope.mockResolvedValue(detail({ status: 'CLOSED' }));
    const useCase = new ReplyAdminTicketUseCase(
      repo as unknown as TicketsRepository,
      notificationsMock() as unknown as NotificationsRepository,
      loggerMock() as unknown as LoggerService,
    );

    await useCase.execute(adminContext(), 'ticket-1', { body: 'reopened' });

    expect(repo.appendAdminMessage).toHaveBeenCalledWith(
      expect.objectContaining({ wasClosed: true }),
    );
  });

  it('rejects an empty body', async () => {
    const repo = repoMock();
    const useCase = new ReplyAdminTicketUseCase(
      repo as unknown as TicketsRepository,
      notificationsMock() as unknown as NotificationsRepository,
      loggerMock() as unknown as LoggerService,
    );

    await expect(
      useCase.execute(adminContext(), 'ticket-1', { body: '   ' }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, reasonKey: 'body_required' });
    expect(repo.getForScope).not.toHaveBeenCalled();
  });

  it('rejects non-admin callers', async () => {
    const repo = repoMock();
    const useCase = new ReplyAdminTicketUseCase(
      repo as unknown as TicketsRepository,
      notificationsMock() as unknown as NotificationsRepository,
      loggerMock() as unknown as LoggerService,
    );

    await expect(
      useCase.execute(adminContext({ ownerType: 'USER', tenantId: 'tenant-1' }), 'ticket-1', { body: 'hi' }),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
  });
});

describe('UpdateAdminTicketStatusUseCase', () => {
  it('updates status and writes an audit log', async () => {
    const repo = repoMock();
    repo.getForScope
      .mockResolvedValueOnce(detail({ status: 'OPEN' }))
      .mockResolvedValueOnce(detail({ status: 'PENDING' }));
    const useCase = new UpdateAdminTicketStatusUseCase(repo as unknown as TicketsRepository);

    const result = await useCase.execute(adminContext(), 'ticket-1', { status: 'PENDING' });

    expect(repo.updateStatus).toHaveBeenCalledWith('ticket-1', 'PENDING');
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'ticket.status_change' }) }),
    );
    expect(result.status).toBe('PENDING');
  });

  it('is a no-op (no audit, no write) when status is unchanged', async () => {
    const repo = repoMock();
    repo.getForScope.mockResolvedValue(detail({ status: 'OPEN' }));
    const useCase = new UpdateAdminTicketStatusUseCase(repo as unknown as TicketsRepository);

    await useCase.execute(adminContext(), 'ticket-1', { status: 'OPEN' });

    expect(repo.updateStatus).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('rejects an invalid status value', async () => {
    const repo = repoMock();
    const useCase = new UpdateAdminTicketStatusUseCase(repo as unknown as TicketsRepository);

    await expect(
      useCase.execute(adminContext(), 'ticket-1', { status: 'ARCHIVED' }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, reasonKey: 'invalid_ticket_status' });
    expect(repo.getForScope).not.toHaveBeenCalled();
  });
});
