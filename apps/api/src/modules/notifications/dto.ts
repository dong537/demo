export interface NotificationListItemDto {
  id: string;
  type: string;
  title: string;
  body: string;
  relatedType: string | null;
  relatedId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface UnreadCountDto {
  count: number;
}
