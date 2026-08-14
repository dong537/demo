import React, { useState } from 'react';
import { Alert, Badge, Button, Drawer, Empty, List, Skeleton, Space, Statistic, Tag, Typography, message } from 'antd';
import { BellOutlined, CheckCircleOutlined, InboxOutlined, NotificationOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { userApiRequest, buildQuery } from '../../shared/api/client';
import { formatCustomerError } from '../../shared/customer/customer-error';
import { formatDateTime } from '../../shared/time/time';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  relatedType: string | null;
  relatedId: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationPage {
  page: number;
  pageSize: number;
  total: number;
  items: NotificationItem[];
}

const UNREAD_COUNT_KEY = ['notifications', 'unread-count'];
const LIST_KEY = ['notifications', 'list'];
const UNREAD_REFETCH_MS = 60_000;

export function buildNotificationListPath(page: number, pageSize: number): string {
  return `/api/notifications${buildQuery({ page, pageSize })}`;
}

export function buildUnreadCountPath(): string {
  return '/api/notifications/unread-count';
}

export function buildMarkReadPath(id: string): string {
  return `/api/notifications/${encodeURIComponent(id)}/read`;
}

export function buildMarkAllReadPath(): string {
  return '/api/notifications/read-all';
}

function getErrorReason(
  error: unknown,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  return formatCustomerError(error, t, 'customer.notifications.reason');
}

export function NotificationCenter() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [actionError, setActionError] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const unreadQuery = useQuery({
    queryKey: UNREAD_COUNT_KEY,
    queryFn: () => userApiRequest<{ count: number }>(buildUnreadCountPath()),
    staleTime: 30_000,
    refetchInterval: UNREAD_REFETCH_MS,
    refetchOnWindowFocus: true,
  });

  const listQuery = useQuery({
    queryKey: [...LIST_KEY, page],
    queryFn: () => userApiRequest<NotificationPage>(buildNotificationListPath(page, pageSize)),
    enabled: open,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
    void qc.invalidateQueries({ queryKey: LIST_KEY });
  };

  const markReadMutation = useMutation({
    mutationFn: (item: NotificationItem) =>
      userApiRequest<void>(buildMarkReadPath(item.id), { method: 'POST' }),
    onSuccess: (_data, item) => {
      setActionError(null);
      setMarkingId(null);
      invalidate();
      if (item.relatedType === 'ticket' && item.relatedId) {
        setOpen(false);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        void navigate({ to: `/tickets/${item.relatedId}` } as any);
      }
    },
    onError: (error) => {
      setMarkingId(null);
      setActionError(getErrorReason(error, t));
    },
  });

  const markAllMutation = useMutation({
    mutationFn: () => userApiRequest<void>(buildMarkAllReadPath(), { method: 'POST' }),
    onSuccess: () => {
      setActionError(null);
      message.success(t('customer.notifications.markAllSuccess'));
      invalidate();
    },
    onError: (error) => {
      setActionError(getErrorReason(error, t));
    },
  });

  const handleOpen = (item: NotificationItem) => {
    if (!item.readAt) {
      setMarkingId(item.id);
      markReadMutation.mutate(item);
      return;
    }
    if (item.relatedType === 'ticket' && item.relatedId) {
      setOpen(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void navigate({ to: `/tickets/${item.relatedId}` } as any);
    }
  };

  const unreadCount = unreadQuery.data?.count;
  const visibleUnreadCount = unreadQuery.isError ? undefined : unreadCount;
  const totalLoaded = listQuery.data ? listQuery.data.items.length : undefined;

  return (
    <>
      <Badge count={visibleUnreadCount} size="small" overflowCount={99}>
        <Button
          type="text"
          className="ipx-notification-trigger"
          icon={<BellOutlined />}
          aria-label={t('customer.notifications.bell')}
          onClick={() => setOpen(true)}
        >
          {t('customer.notifications.bell')}
        </Button>
      </Badge>
      <Drawer
        title={t('customer.notifications.title')}
        open={open}
        onClose={() => setOpen(false)}
        width={420}
        className="ipx-notification-drawer"
        styles={{
          body: { padding: 12, background: 'var(--ipx-bg, #fafafc)' },
          header: { borderBottom: '1px solid var(--ipx-border, #d8d8d8)' },
        }}
        extra={
          <Button
            size="small"
            icon={<CheckCircleOutlined />}
            aria-label={t('customer.notifications.markAll')}
            disabled={unreadQuery.isError || !visibleUnreadCount}
            loading={markAllMutation.isPending}
            onClick={() => markAllMutation.mutate()}
          >
            {t('customer.notifications.markAll')}
          </Button>
        }
      >
        {actionError && (
          <Alert type="error" message={actionError} showIcon closable onClose={() => setActionError(null)} style={{ marginBottom: 12 }} />
        )}
        {unreadQuery.isError && (
          <Alert
            type="error"
            message={t('error')}
            description={getErrorReason(unreadQuery.error, t)}
            showIcon
            style={{ marginBottom: 12 }}
          />
        )}
        <Space direction="vertical" size={10} style={{ width: '100%', marginBottom: 12 }}>
          <Space align="start" size={10}>
            <NotificationOutlined style={{ fontSize: 18, color: 'var(--ipx-accent)' }} />
            <Space direction="vertical" size={2}>
              <Typography.Text className="ipx-overview-card-label">
                {t('customer.notifications.kicker')}
              </Typography.Text>
              <Typography.Text strong>{t('customer.notifications.heroTitle')}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12, lineHeight: 1.5 }}>
                {t('customer.notifications.description')}
              </Typography.Text>
            </Space>
          </Space>
          <Space size={8} wrap>
            <Statistic
              title={t('customer.notifications.unreadCount')}
              value={unreadQuery.isLoading || unreadQuery.isError ? '-' : visibleUnreadCount}
            />
            <Statistic
              title={t('customer.notifications.loadedCount')}
              value={listQuery.isLoading || listQuery.isError || totalLoaded === undefined ? '-' : totalLoaded}
            />
          </Space>
        </Space>
        {listQuery.isLoading ? (
          <Skeleton active />
        ) : listQuery.error ? (
            <Alert type="error" message={getErrorReason(listQuery.error, t)} showIcon />
        ) : (listQuery.data?.items.length ?? 0) === 0 ? (
          <Empty image={<InboxOutlined />} description={t('customer.notifications.empty')} />
        ) : (
          <List
            className="ipx-notification-list"
            dataSource={listQuery.data?.items ?? []}
            renderItem={(item) => (
              <List.Item
                className={item.readAt ? 'ipx-notification-item' : 'ipx-notification-item is-unread'}
                style={{ cursor: markingId === item.id ? 'wait' : 'pointer' }}
                onClick={() => handleOpen(item)}
              >
                <List.Item.Meta
                  title={
                    <Space size={8} align="center" wrap>
                      <Typography.Text strong className="ipx-notification-title">
                        {item.title}
                      </Typography.Text>
                      {!item.readAt && <Tag color="blue">{t('customer.notifications.unread')}</Tag>}
                      {item.relatedType === 'ticket' && <Tag>{t('customer.notifications.relatedTicket')}</Tag>}
                      {markingId === item.id && markReadMutation.isPending && <Tag color="processing">{t('loading')}</Tag>}
                    </Space>
                  }
                  description={
                    <Space direction="vertical" size={5}>
                      <Typography.Text type="secondary" className="ipx-notification-body">
                        {item.body}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {formatDateTime(item.createdAt)}
                      </Typography.Text>
                    </Space>
                  }
                />
              </List.Item>
            )}
            pagination={{
              current: page,
              pageSize,
              total: listQuery.data?.total ?? 0,
              onChange: (p) => setPage(p),
              size: 'small',
              hideOnSinglePage: true,
            }}
          />
        )}
      </Drawer>
    </>
  );
}
