import React, { useEffect } from 'react';
import { Alert, Button, Card, Col, Descriptions, Empty, Form, Input, Row, Skeleton, Space, Tag, Typography, message } from 'antd';
import {
  CheckCircleOutlined,
  ClusterOutlined,
  GlobalOutlined,
  IdcardOutlined,
  LockOutlined,
  MailOutlined,
  PhoneOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { userApiRequest } from '../../shared/api/client';
import { clearCurrentUserCache, getCurrentUserQueryKey, useCurrentCustomer } from '../../shared/auth/current-user';
import { formatCustomerError } from '../../shared/customer/customer-error';
import { formatBrandName } from '../../shared/site/brand-display';
import { PageHeader } from '../../shared/ui/page-header';
import { surfaceCardStyle } from '../../shared/ui/surface';
import { accountStatusColor } from '../../shared/user/user-labels';

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  status: string;
  kycStatus: string;
  riskStatus: string;
}

interface SiteBrand {
  name?: string;
  siteName?: string;
}

interface CurrentSiteInfo {
  site?: { id: string; name?: string; domain?: string | null; brandConfig?: SiteBrand | null } | null;
  tenant?: { id: string; code?: string; name?: string; brandConfig?: SiteBrand | null } | null;
  announcements?: unknown[];
}

interface ProfileFormValues {
  name?: string;
  phone?: string;
}

interface PasswordFormValues {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export const MIN_PASSWORD_LENGTH = 8;

export const USERS_ME_QUERY_KEY = ['users', 'me'] as const;
export const CURRENT_SITE_PROFILE_QUERY_KEY = ['site', 'current', 'customer-profile'] as const;

export function buildUpdateProfileBody(values: ProfileFormValues): { name: string; phone: string } {
  return {
    name: values.name?.trim() ?? '',
    phone: values.phone?.trim() ?? '',
  };
}

export function buildChangePasswordBody(values: PasswordFormValues): { oldPassword: string; newPassword: string } {
  return {
    oldPassword: values.oldPassword,
    newPassword: values.newPassword,
  };
}

export function CustomerProfileFeature() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [profileForm] = Form.useForm<ProfileFormValues>();
  const [passwordForm] = Form.useForm<PasswordFormValues>();
  const currentQuery = useCurrentCustomer();

  const profileQuery = useQuery({
    queryKey: USERS_ME_QUERY_KEY,
    queryFn: () => userApiRequest<UserProfile>('/api/users/me'),
  });

  const siteQuery = useQuery({
    queryKey: CURRENT_SITE_PROFILE_QUERY_KEY,
    queryFn: () => userApiRequest<CurrentSiteInfo>('/api/sites/current'),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (profileQuery.data) {
      profileForm.setFieldsValue({
        name: profileQuery.data.name ?? '',
        phone: profileQuery.data.phone ?? '',
      });
    }
  }, [profileQuery.data, profileForm]);

  const updateMutation = useMutation({
    mutationFn: (values: ProfileFormValues) =>
      userApiRequest<UserProfile>('/api/users/me', {
        method: 'PUT',
        body: JSON.stringify(buildUpdateProfileBody(values)),
      }),
    onSuccess: () => {
      message.success(t('customer.profile.saveSuccess'));
      void qc.invalidateQueries({ queryKey: USERS_ME_QUERY_KEY });
      void qc.invalidateQueries({ queryKey: getCurrentUserQueryKey('customer') });
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: (values: PasswordFormValues) =>
      userApiRequest<void>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify(buildChangePasswordBody(values)),
      }),
    onSuccess: () => {
      message.success(t('customer.profile.changeSuccess'));
      passwordForm.resetFields();
      clearCurrentUserCache('customer');
      void qc.invalidateQueries({ queryKey: USERS_ME_QUERY_KEY });
      void qc.invalidateQueries({ queryKey: getCurrentUserQueryKey('customer') });
    },
  });

  const profileReason = (error: unknown): string =>
    formatCustomerError(error, t, 'customer.profile.reason');

  return (
    <Space className="ipx-profile-page" direction="vertical" size={16} style={{ display: 'flex' }}>
      <PageHeader
        kicker={t('customer.profile.kicker')}
        title={t('customer.profile.title')}
        description={t('customer.profile.description')}
      />

      {profileQuery.isLoading ? (
        <Skeleton active paragraph={{ rows: 5 }} />
      ) : profileQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message={t('error')}
          description={profileReason(profileQuery.error)}
        />
      ) : profileQuery.data ? (
        <ProfileSummaryCard profile={profileQuery.data} />
      ) : (
        <Alert
          type="info"
          showIcon
          message={t('customer.profile.emptyAccount')}
          description={t('customer.profile.emptyAccountDescription')}
        />
      )}

      {profileQuery.isFetching && !profileQuery.isLoading && (
        <Alert
          type="info"
          showIcon
          message={t('customer.profile.refreshingProfile')}
        />
      )}

      <AccountContextCards
        profile={profileQuery.data}
        profileLoading={profileQuery.isLoading}
        profileError={profileQuery.isError ? profileQuery.error : null}
        currentQuery={{
          isLoading: currentQuery.isLoading,
          isError: currentQuery.isError,
          error: currentQuery.error,
          data: currentQuery.data,
        }}
        siteQuery={{
          isLoading: siteQuery.isLoading,
          isError: siteQuery.isError,
          error: siteQuery.error,
          data: siteQuery.data,
        }}
      />

      <Row gutter={[16, 16]} align="top">
        <Col xs={24} xl={15}>
          <Card
            className="ipx-profile-form-card"
            title={(
              <Space size={10}>
                <UserOutlined style={{ color: 'var(--ipx-primary)' }} />
                <span>{t('customer.profile.profileSection')}</span>
              </Space>
            )}
            variant="borderless"
            style={surfaceCardStyle({ borderRadius: 8, boxShadow: 'none' })}
            styles={{ body: { padding: 20 } }}
          >
        {profileQuery.isLoading ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : profileQuery.isError ? (
          <Alert
            type="error"
            showIcon
            message={t('error')}
            description={profileReason(profileQuery.error)}
          />
        ) : profileQuery.data ? (
          <>
            <Descriptions
              column={{ xs: 1, md: 2 }}
              size="small"
              className="ipx-profile-descriptions"
              style={{ marginBottom: 20 }}
            >
              <Descriptions.Item label={t('customer.profile.email')}>
                {profileQuery.data.email}
              </Descriptions.Item>
              <Descriptions.Item label={t('customer.profile.status')}>
                <StatusTag value={profileQuery.data.status} />
              </Descriptions.Item>
              <Descriptions.Item label={t('customer.profile.kycStatus')}>
                <StatusTag value={profileQuery.data.kycStatus} />
              </Descriptions.Item>
              <Descriptions.Item label={t('customer.profile.riskStatus')}>
                <StatusTag value={profileQuery.data.riskStatus} />
              </Descriptions.Item>
            </Descriptions>
            {updateMutation.isError && (
              <Alert
                type="error"
                showIcon
                closable
                style={{ marginBottom: 16 }}
                message={t('error')}
                description={profileReason(updateMutation.error)}
              />
            )}
            {updateMutation.isPending && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message={t('customer.profile.savePending')}
              />
            )}
            {profileQuery.isFetching && !profileQuery.isLoading && updateMutation.isSuccess && (
              <Alert
                type="success"
                showIcon
                style={{ marginBottom: 16 }}
                message={t('customer.profile.saveRefreshing')}
              />
            )}
            <Form
              form={profileForm}
              layout="vertical"
              onFinish={(values) => updateMutation.mutate(values)}
            >
              <Form.Item label={t('customer.profile.email')}>
                <Input value={profileQuery.data.email} disabled size="large" />
                <Typography.Text type="secondary">
                  {t('customer.profile.emailReadonly')}
                </Typography.Text>
              </Form.Item>
              <Form.Item name="name" label={t('customer.profile.name')}>
                <Input placeholder={t('customer.profile.namePlaceholder')} allowClear size="large" />
              </Form.Item>
              <Form.Item name="phone" label={t('customer.profile.phone')}>
                <Input placeholder={t('customer.profile.phonePlaceholder')} allowClear size="large" />
              </Form.Item>
              <Form.Item>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={updateMutation.isPending}
                  disabled={profileQuery.isFetching}
                  size="large"
                >
                  {t('customer.profile.save')}
                </Button>
              </Form.Item>
            </Form>
          </>
        ) : null}
          </Card>
        </Col>

        <Col xs={24} xl={9}>
          <Card
            className="ipx-profile-security-card"
            title={(
              <Space size={10}>
                <LockOutlined style={{ color: 'var(--ipx-primary)' }} />
                <span>{t('customer.profile.passwordSection')}</span>
              </Space>
            )}
            variant="borderless"
            style={surfaceCardStyle({ borderRadius: 8, boxShadow: 'none' })}
            styles={{ body: { padding: 20 } }}
          >
        <Alert
          className="ipx-profile-security-hint"
          type="info"
          showIcon
          message={t('customer.profile.passwordHint')}
          style={{ marginBottom: 16 }}
        />
        {changePasswordMutation.isError && (
          <Alert
            type="error"
            showIcon
            closable
            style={{ marginBottom: 16 }}
            message={t('error')}
            description={profileReason(changePasswordMutation.error)}
          />
        )}
        {changePasswordMutation.isPending && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={t('customer.profile.changePending')}
          />
        )}
        {currentQuery.isFetching && !currentQuery.isLoading && changePasswordMutation.isSuccess && (
          <Alert
            type="success"
            showIcon
            style={{ marginBottom: 16 }}
            message={t('customer.profile.changeRefreshing')}
          />
        )}
        <Form
          form={passwordForm}
          layout="vertical"
          onFinish={(values) => changePasswordMutation.mutate(values)}
        >
          <Form.Item
            name="oldPassword"
            label={t('customer.profile.oldPassword')}
            rules={[{ required: true, message: t('customer.profile.oldPasswordRequired') }]}
          >
            <Input.Password placeholder={t('customer.profile.oldPasswordPlaceholder')} size="large" />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label={t('customer.profile.newPassword')}
            rules={[
              { required: true, message: t('customer.profile.newPasswordRequired') },
              { min: MIN_PASSWORD_LENGTH, message: t('customer.profile.newPasswordTooShort') },
            ]}
          >
            <Input.Password placeholder={t('customer.profile.newPasswordPlaceholder')} size="large" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label={t('customer.profile.confirmPassword')}
            dependencies={['newPassword']}
            rules={[
              { required: true, message: t('customer.profile.confirmPasswordRequired') },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error(t('customer.profile.confirmMismatch')));
                },
              }),
            ]}
          >
            <Input.Password placeholder={t('customer.profile.confirmPasswordPlaceholder')} size="large" />
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={changePasswordMutation.isPending}
              disabled={currentQuery.isFetching}
              size="large"
            >
              {t('customer.profile.changePassword')}
            </Button>
          </Form.Item>
        </Form>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

function ProfileSummaryCard({ profile }: { profile: UserProfile }) {
  const { t } = useTranslation();
  const displayName = profile.name || profile.email;
  const phoneDisplay = profile.phone || t('customer.profile.notSet');
  return (
    <Card
      className="ipx-profile-summary-card"
      variant="borderless"
      style={surfaceCardStyle({ borderRadius: 8, boxShadow: 'none' })}
      styles={{ body: { padding: 20 } }}
    >
      <Row gutter={[16, 16]} align="middle">
        <Col xs={24} lg={9}>
          <Space size={14} align="center" className="ipx-profile-identity">
            <div className="ipx-profile-avatar" aria-hidden>
              {displayName.slice(0, 1).toUpperCase()}
            </div>
            <div className="ipx-truncate">
              <Typography.Text className="ipx-profile-eyebrow">{t('customer.profile.identity')}</Typography.Text>
              <Typography.Title level={4} className="ipx-profile-name">{displayName}</Typography.Title>
              <Typography.Text type="secondary" className="ipx-profile-email">
                <MailOutlined /> {profile.email}
              </Typography.Text>
            </div>
          </Space>
        </Col>
        <Col xs={24} lg={15}>
          <div className="ipx-profile-status-grid">
            <ProfileStatusMetric icon={<IdcardOutlined />} label={t('customer.profile.accountId')} value={profile.id} />
            <ProfileStatusMetric icon={<PhoneOutlined />} label={t('customer.profile.phone')} value={phoneDisplay} />
            <ProfileStatusMetric icon={<SafetyCertificateOutlined />} label={t('customer.profile.status')} value={<StatusTag value={profile.status} />} />
            <ProfileStatusMetric icon={<CheckCircleOutlined />} label={t('customer.profile.riskStatus')} value={<StatusTag value={profile.riskStatus} />} />
          </div>
        </Col>
      </Row>
    </Card>
  );
}

function AccountContextCards({
  profile,
  profileLoading,
  profileError,
  currentQuery,
  siteQuery,
}: {
  profile: UserProfile | undefined;
  profileLoading: boolean;
  profileError: unknown;
  currentQuery: {
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    data?: { ownerId: string; ownerType: string; siteId: string; tenantId: string | null; scopes: string[] };
  };
  siteQuery: {
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    data?: CurrentSiteInfo;
  };
}) {
  const { t } = useTranslation();
  const profileReason = (error: unknown): string =>
    formatCustomerError(error, t, 'customer.profile.reason');

  return (
    <Row gutter={[16, 16]} align="stretch">
      <Col xs={24} lg={8}>
        <Card
          title={<CardTitle icon={<IdcardOutlined />} text={t('customer.profile.identity')} />}
          variant="borderless"
          style={surfaceCardStyle({ borderRadius: 8, boxShadow: 'none' })}
          styles={{ body: { padding: 16 } }}
        >
          {profileLoading ? (
            <Skeleton active paragraph={{ rows: 3 }} />
          ) : profileError ? (
            <Alert type="error" showIcon message={t('error')} description={profileReason(profileError)} />
          ) : profile ? (
            <Descriptions column={1} size="small">
              <Descriptions.Item label={t('customer.profile.accountId')}>{profile.id}</Descriptions.Item>
              <Descriptions.Item label={t('customer.profile.email')}>{profile.email}</Descriptions.Item>
              <Descriptions.Item label={t('customer.profile.status')}><StatusTag value={profile.status} /></Descriptions.Item>
            </Descriptions>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('customer.profile.emptyAccount')} />
          )}
        </Card>
      </Col>
      <Col xs={24} lg={8}>
        <Card
          title={<CardTitle icon={<SafetyCertificateOutlined />} text={t('customer.profile.passwordSection')} />}
          variant="borderless"
          style={surfaceCardStyle({ borderRadius: 8, boxShadow: 'none' })}
          styles={{ body: { padding: 16 } }}
        >
          {currentQuery.isLoading ? (
            <Skeleton active paragraph={{ rows: 3 }} />
          ) : currentQuery.isError ? (
            <Alert type="error" showIcon message={t('error')} description={profileReason(currentQuery.error)} />
          ) : currentQuery.data ? (
            <Descriptions column={1} size="small">
              <Descriptions.Item label={t('customer.profile.sessionRole')}>
                <Tag color="blue">{formatCustomerOwnerType(currentQuery.data.ownerType, t)}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('customer.profile.accountId')}>{currentQuery.data.ownerId}</Descriptions.Item>
              <Descriptions.Item label={t('customer.profile.sessionScopes')}>
                {currentQuery.data.scopes.length > 0 ? (
                  <Space size={[4, 4]} wrap>
                    {currentQuery.data.scopes.map((scope) => <Tag key={scope}>{formatCustomerScope(scope, t)}</Tag>)}
                  </Space>
                ) : t('customer.profile.notSet')}
              </Descriptions.Item>
            </Descriptions>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('customer.profile.emptySecurity')} />
          )}
        </Card>
      </Col>
      <Col xs={24} lg={8}>
        <Card
          title={<CardTitle icon={<GlobalOutlined />} text={t('customer.profile.siteContext')} />}
          variant="borderless"
          style={surfaceCardStyle({ borderRadius: 8, boxShadow: 'none' })}
          styles={{ body: { padding: 16 } }}
        >
          {siteQuery.isLoading ? (
            <Skeleton active paragraph={{ rows: 3 }} />
          ) : siteQuery.isError ? (
            <Alert type="error" showIcon message={t('error')} description={profileReason(siteQuery.error)} />
          ) : siteQuery.data ? (
            <Descriptions column={1} size="small">
              <Descriptions.Item label={t('customer.profile.siteName')}>
                {resolveDisplayName(siteQuery.data.site) || t('customer.profile.notSet')}
              </Descriptions.Item>
              <Descriptions.Item label={t('customer.profile.siteId')}>{siteQuery.data.site?.id ?? t('customer.profile.notSet')}</Descriptions.Item>
              <Descriptions.Item label={t('customer.profile.tenantId')}>
                {siteQuery.data.tenant ? (
                  <Space size={6} wrap>
                    <ClusterOutlined />
                    <span>{resolveDisplayName(siteQuery.data.tenant) || siteQuery.data.tenant.id}</span>
                    <Tag>{siteQuery.data.tenant.id}</Tag>
                  </Space>
                ) : t('customer.profile.notSet')}
              </Descriptions.Item>
            </Descriptions>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('customer.profile.emptySite')} />
          )}
        </Card>
      </Col>
    </Row>
  );
}

function resolveDisplayName(entity?: { name?: string; brandConfig?: SiteBrand | null } | null): string {
  const brand = entity?.brandConfig ?? {};
  return formatBrandName(brand.name || brand.siteName || entity?.name) || '';
}

function CardTitle({ icon, text }: { icon: React.ReactNode; text: React.ReactNode }) {
  return (
    <Space size={10}>
      <span style={{ color: 'var(--ipx-primary)' }}>{icon}</span>
      <span>{text}</span>
    </Space>
  );
}

function ProfileStatusMetric({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  value: React.ReactNode;
}) {
  return (
    <div className="ipx-profile-status-metric">
      <Typography.Text type="secondary" className="ipx-profile-status-label">
        {icon} {label}
      </Typography.Text>
      <Typography.Text strong className="ipx-profile-status-value">
        {value}
      </Typography.Text>
    </div>
  );
}

function StatusTag({ value }: { value: string }) {
  const { t } = useTranslation();
  const key = `customer.profile.statusValue.${value}`;
  const label = t(key, { defaultValue: t('customer.profile.statusUnknown', { defaultValue: t('customer.profile.notSet') }) });
  return (
    <Tag color={accountStatusColor(value)} style={{ marginInlineEnd: 0 }}>
      {label}
    </Tag>
  );
}

function formatCustomerOwnerType(
  ownerType: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  return t(`customer.profile.ownerType.${ownerType}`, {
    defaultValue: t('customer.profile.ownerType.USER', { defaultValue: '客户' }),
  });
}

function formatCustomerScope(
  scope: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (scope === 'res_static:*') {
    return t('customer.profile.scopeValue.resStatic', { defaultValue: '静态代理接口权限' });
  }
  return t('customer.profile.scopeValue.generic', { defaultValue: '接口权限' });
}
