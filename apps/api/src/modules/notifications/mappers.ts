import { Notification } from './notifications.repository';
import { NotificationListItemDto } from './dto';

export function toNotificationListItem(n: Notification): NotificationListItemDto {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    relatedType: n.relatedType,
    relatedId: n.relatedId,
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
}
