import React from 'react';
import { Space, Typography } from 'antd';

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  extra?: React.ReactNode;
  kicker?: React.ReactNode;
}

export function PageHeader({ title, description, extra, kicker }: PageHeaderProps) {
  return (
    <div className="ipx-page-header">
      <Space direction="vertical" size={2} style={{ minWidth: 0 }}>
        {kicker && <span className="ipx-page-kicker">{kicker}</span>}
        <Typography.Title level={3} className="ipx-page-title">
          {title}
        </Typography.Title>
        {description && (
          <Typography.Text className="ipx-page-description">{description}</Typography.Text>
        )}
      </Space>
      {extra && <Space wrap size={8}>{extra}</Space>}
    </div>
  );
}
