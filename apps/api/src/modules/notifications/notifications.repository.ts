import { Injectable } from '@nestjs/common';
import { prisma, Prisma } from '@ipeasy/db';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PageQueryDto, PageResult, normalizePageQuery } from '../../common/pagination/pagination.dto';
import { NotificationOwnerScope } from './access';

export type Notification = Prisma.notificationsGetPayload<Record<string, never>>;

export interface NotificationListQuery extends PageQueryDto {
  unreadOnly?: string | boolean;
}

@Injectable()
export class NotificationsRepository {
  /**
   * Produces one notification for a user. Called by domain events (currently the
   * admin ticket reply) — never exposed as a customer-writable surface. siteId
   * and tenantId belong to the target user, not the actor.
   */
  async createForUser(data: {
    siteId: string;
    tenantId: string;
    userId: string;
    type: string;
    title: string;
    body: string;
    relatedType?: string;
    relatedId?: string;
  }): Promise<Notification> {
    return prisma.notifications.create({
      data: {
        siteId: data.siteId,
        tenantId: data.tenantId,
        userId: data.userId,
        type: data.type,
        title: data.title,
        body: data.body,
        relatedType: data.relatedType ?? null,
        relatedId: data.relatedId ?? null,
      },
    });
  }

  async listForOwner(
    owner: NotificationOwnerScope,
    query: NotificationListQuery,
  ): Promise<PageResult<Notification>> {
    const { page, pageSize } = normalizePageQuery(query);
    const where: Prisma.notificationsWhereInput = {
      userId: owner.userId,
      siteId: owner.siteId,
      tenantId: owner.tenantId,
    };
    if (query.unreadOnly === true || query.unreadOnly === 'true') {
      where.readAt = null;
    }

    const [total, items] = await Promise.all([
      prisma.notifications.count({ where }),
      prisma.notifications.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { page, pageSize, total, items };
  }

  async countUnread(owner: NotificationOwnerScope): Promise<number> {
    return prisma.notifications.count({
      where: {
        userId: owner.userId,
        siteId: owner.siteId,
        tenantId: owner.tenantId,
        readAt: null,
      },
    });
  }

  /**
   * Marks one notification read. A notification that exists but is not owned by
   * the caller is reported as NOT_FOUND so existence is not leaked. Idempotent:
   * marking an already-read notification keeps its original readAt and does not
   * error.
   */
  async markRead(id: string, owner: NotificationOwnerScope): Promise<void> {
    const notification = await prisma.notifications.findFirst({
      where: {
        id,
        userId: owner.userId,
        siteId: owner.siteId,
        tenantId: owner.tenantId,
      },
    });
    if (!notification) throw new AppError(ErrorCode.NOT_FOUND, 'notification_not_found', 404);
    if (notification.readAt) return;
    await prisma.notifications.update({
      where: { id: notification.id },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(owner: NotificationOwnerScope): Promise<number> {
    const result = await prisma.notifications.updateMany({
      where: {
        userId: owner.userId,
        siteId: owner.siteId,
        tenantId: owner.tenantId,
        readAt: null,
      },
      data: { readAt: new Date() },
    });
    return result.count;
  }
}
