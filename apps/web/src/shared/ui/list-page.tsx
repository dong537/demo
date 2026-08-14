import React from 'react';
import { Alert, Card, Empty, Skeleton, Table } from 'antd';
import type { ColumnsType, TableProps } from 'antd/es/table';
import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ApiError } from '../api/client';

export interface PageResult<T> {
  page: number;
  pageSize: number;
  total: number;
  items: T[];
}

interface ListPageProps<T extends object> {
  query: UseQueryResult<PageResult<T>>;
  columns: ColumnsType<T>;
  toolbar?: React.ReactNode;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    onChange: (page: number, pageSize: number) => void;
  };
  rowKey: string | ((r: T) => string);
  rowSelection?: TableProps<T>['rowSelection'];
  rowClassName?: TableProps<T>['rowClassName'];
  emptyText?: React.ReactNode;
  errorDescription?: (error: unknown) => React.ReactNode;
}

export function ListPage<T extends object>({
  query,
  columns,
  toolbar,
  pagination,
  rowKey,
  rowSelection,
  rowClassName,
  emptyText,
  errorDescription,
}: ListPageProps<T>) {
  const { t } = useTranslation();
  const { data, isLoading, error } = query;

  if (isLoading) {
    return (
      <Card className="ipx-surface-card ipx-list-loading ipx-list-table-card" variant="borderless">
        <Skeleton active paragraph={{ rows: 6 }} />
      </Card>
    );
  }

  if (error) {
    const apiErr = error as ApiError;
    const isPermission = apiErr.code === 'PERMISSION_DENIED' || apiErr.code === 403;
    return (
      <Alert
        type={isPermission ? 'warning' : 'error'}
        message={isPermission ? t('permissionDenied') : t('error')}
        description={errorDescription ? errorDescription(error) : t('error')}
        showIcon
      />
    );
  }

  return (
    <>
      {toolbar && <div className="ipx-list-toolbar" role="region">{toolbar}</div>}
      <Card
        className="ipx-surface-card ipx-list-table-card"
        variant="borderless"
        style={{
          overflow: 'hidden',
        }}
        styles={{ body: { padding: 0 } }}
      >
        <Table<T>
          columns={columns}
          dataSource={data?.items ?? []}
          rowKey={rowKey}
          rowSelection={rowSelection}
          rowClassName={rowClassName}
          size="small"
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: <Empty description={emptyText ?? t('empty')} /> }}
          pagination={{
            current: pagination.page,
            pageSize: pagination.pageSize,
            total: pagination.total,
            onChange: pagination.onChange,
            showTotal: (total) => t('total', { total }),
            showSizeChanger: false,
            style: { paddingInline: 14, marginBlock: 12 },
          }}
        />
      </Card>
    </>
  );
}
