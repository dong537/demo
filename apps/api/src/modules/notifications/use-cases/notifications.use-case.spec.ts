import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { ErrorCode } from '../../../common/errors/error-codes';

const notificationsDb = vi.hoisted(() => ({
  create: vi.fn(),
  count: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
}));
vi.mock('@ipeasy/db', () => ({
  prisma: { notifications: notificationsDb },
  Prisma: {},
}));

import { NotificationsRepository } from '../notifications.repository';
import { ListNotificationsUseCase } from './list-notifications.use-case';
import { GetUnreadCountUseCase } from './get-unread-count.use-case';
import { MarkNotificationReadUseCase } from './mark-notification-read.use-case';
import { MarkAllNotificationsReadUseCase } from './mark-all-notifications-read.use-case';

function userContext(overrides: Partial<AuthenticatedContext> = {}): AuthenticatedContext {
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

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'notif-1',
    siteId: 'site-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    type: 'ticket_reply',
    title: 'cannot connect',
    body: 'we replied',
    relatedType: 'ticket',
    relatedId: 'ticket-1',
    readAt: null,
    createdAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  Object.values(notificationsDb).forEach((fn) => fn.mockReset());
});

describe('ListNotificationsUseCase', () => {
  it('scopes the query to the caller (userId + site + tenant) and maps items', async () => {
    notificationsDb.count.mockResolvedValue(1);
    notificationsDb.findMany.mockResolvedValue([row()]);
    const useCase = new ListNotificationsUseCase(new NotificationsRepository());

    const result = await useCase.execute(userContext(), { page: 1, pageSize: 20 });

    const whereArg = notificationsDb.findMany.mock.calls[0]![0].where;
    expect(whereArg).toEqual({ userId: 'user-1', siteId: 'site-1', tenantId: 'tenant-1' });
    expect(result.items[0]).toEqual({
      id: 'notif-1',
      type: 'ticket_reply',
      title: 'cannot connect',
      body: 'we replied',
      relatedType: 'ticket',
      relatedId: 'ticket-1',
      readAt: null,
      createdAt: now,
    });
  });

  it('filters to unread when unreadOnly=true', async () => {
    notificationsDb.count.mockResolvedValue(0);
    notificationsDb.findMany.mockResolvedValue([]);
    const useCase = new ListNotificationsUseCase(new NotificationsRepository());

    await useCase.execute(userContext(), { page: 1, pageSize: 20, unreadOnly: 'true' });

    expect(notificationsDb.findMany.mock.calls[0]![0].where).toMatchObject({ readAt: null });
  });

  it('rejects non-USER callers', async () => {
    const useCase = new ListNotificationsUseCase(new NotificationsRepository());
    await expect(
      useCase.execute(userContext({ ownerType: 'PLATFORM_ADMIN', tenantId: null }), { page: 1, pageSize: 20 }),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
    expect(notificationsDb.findMany).not.toHaveBeenCalled();
  });
});

describe('GetUnreadCountUseCase', () => {
  it('counts only the caller unread notifications', async () => {
    notificationsDb.count.mockResolvedValue(3);
    const useCase = new GetUnreadCountUseCase(new NotificationsRepository());

    const result = await useCase.execute(userContext());

    expect(result).toEqual({ count: 3 });
    expect(notificationsDb.count.mock.calls[0]![0].where).toEqual({
      userId: 'user-1',
      siteId: 'site-1',
      tenantId: 'tenant-1',
      readAt: null,
    });
  });
});

describe('MarkNotificationReadUseCase', () => {
  it('marks an owned unread notification as read', async () => {
    notificationsDb.findFirst.mockResolvedValue(row({ readAt: null }));
    notificationsDb.update.mockResolvedValue(row({ readAt: now }));
    const useCase = new MarkNotificationReadUseCase(new NotificationsRepository());

    await useCase.execute(userContext(), 'notif-1');

    expect(notificationsDb.findFirst.mock.calls[0]![0].where).toMatchObject({
      id: 'notif-1',
      userId: 'user-1',
      siteId: 'site-1',
      tenantId: 'tenant-1',
    });
    expect(notificationsDb.update).toHaveBeenCalled();
  });

  it('is idempotent: an already-read notification is not updated again', async () => {
    notificationsDb.findFirst.mockResolvedValue(row({ readAt: now }));
    const useCase = new MarkNotificationReadUseCase(new NotificationsRepository());

    await useCase.execute(userContext(), 'notif-1');

    expect(notificationsDb.update).not.toHaveBeenCalled();
  });

  it('reports NOT_FOUND for a notification owned by someone else', async () => {
    notificationsDb.findFirst.mockResolvedValue(null);
    const useCase = new MarkNotificationReadUseCase(new NotificationsRepository());

    await expect(useCase.execute(userContext(), 'other')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      reasonKey: 'notification_not_found',
    });
    expect(notificationsDb.update).not.toHaveBeenCalled();
  });
});

describe('MarkAllNotificationsReadUseCase', () => {
  it('marks all unread notifications for the caller as read', async () => {
    notificationsDb.updateMany.mockResolvedValue({ count: 2 });
    const useCase = new MarkAllNotificationsReadUseCase(new NotificationsRepository());

    await useCase.execute(userContext());

    expect(notificationsDb.updateMany.mock.calls[0]![0].where).toEqual({
      userId: 'user-1',
      siteId: 'site-1',
      tenantId: 'tenant-1',
      readAt: null,
    });
  });
});
