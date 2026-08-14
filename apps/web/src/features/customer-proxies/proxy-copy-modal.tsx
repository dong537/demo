import React, { useState } from 'react';
import { Button, Modal, Space, Tag, Typography, message } from 'antd';
import { useTranslation } from 'react-i18next';

interface ProxyInfo {
  ip: string;
  port: number;
  username: string;
  password: string;
}

interface Props {
  proxy: ProxyInfo;
  onClose: () => void;
}

export function ProxyCopyModal({ proxy, onClose }: Props) {
  const { t } = useTranslation();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const { ip, port, username, password } = proxy;
  const formats = [
    { key: 'ipPort', value: `${ip}:${port}` },
    { key: 'ipPortUserPass', value: `${ip}:${port}:${username}:${password}` },
    { key: 'userPassAtIpPort', value: `${username}:${password}@${ip}:${port}` },
    { key: 'httpUrl', value: `http://${username}:${password}@${ip}:${port}` },
    { key: 'socks5Url', value: `socks5://${username}:${password}@${ip}:${port}` },
  ];

  const copy = (key: string, value: string) => {
    void navigator.clipboard.writeText(value)
      .then(() => {
        setCopiedKey(key);
        message.success(t('customer.proxies.copyModal.copySuccess'));
        setTimeout(() => setCopiedKey(null), 1500);
      })
      .catch(() => {
        message.error(t('customer.proxies.copyModal.copyFailed'));
      });
  };

  return (
    <Modal
      className="ipx-proxy-copy-modal"
      title={t('customer.proxies.copyModal.title')}
      open
      onCancel={onClose}
      footer={null}
    >
      <Space className="ipx-proxy-copy-list" direction="vertical" size={12}>
        <div className="ipx-proxy-copy-row">
          <Space direction="vertical" size={4} className="ipx-proxy-copy-text">
            <Typography.Text type="secondary" className="ipx-proxy-copy-label">
              {t('customer.proxies.copyAllFormats')}
            </Typography.Text>
            <Typography.Text code className="ipx-proxy-copy-value">
              {formats.map((item) => item.value).join('\n')}
            </Typography.Text>
          </Space>
          <Button
            size="small"
            type={copiedKey === 'all' ? 'primary' : 'default'}
            onClick={() => copy('all', formats.map((item) => item.value).join('\n'))}
          >
            {copiedKey === 'all' ? t('customer.proxies.copyModal.copied') : t('confirm')}
          </Button>
        </div>
        <div className="ipx-proxy-copy-row">
          <Space direction="vertical" size={4} className="ipx-proxy-copy-text">
            <Typography.Text type="secondary" className="ipx-proxy-copy-label">
              {t('customer.proxies.copyModal.endpoint')}
            </Typography.Text>
            <Space size={6} wrap>
              <Tag>{ip}</Tag>
              <Tag>{port}</Tag>
              <Tag>{username}</Tag>
            </Space>
          </Space>
          <Button size="small" onClick={() => copy('endpoint', `${ip}:${port}`)}>
            {copiedKey === 'endpoint' ? t('customer.proxies.copyModal.copied') : t('confirm')}
          </Button>
        </div>
        {formats.map(({ key, value }) => (
          <div key={key} className="ipx-proxy-copy-row">
            <Space direction="vertical" size={4} className="ipx-proxy-copy-text">
              <Typography.Text type="secondary" className="ipx-proxy-copy-label">
                {t(`customer.proxies.copyModal.${key}`)}
              </Typography.Text>
              <Typography.Text code className="ipx-proxy-copy-value">
                {value}
              </Typography.Text>
            </Space>
            <Button
              size="small"
              type={copiedKey === key ? 'primary' : 'default'}
              onClick={() => copy(key, value)}
            >
              {copiedKey === key ? t('customer.proxies.copyModal.copied') : t('confirm')}
            </Button>
          </div>
        ))}
      </Space>
    </Modal>
  );
}
