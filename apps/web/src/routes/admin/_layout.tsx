import React from 'react';
import { Avatar, Badge, Button, Drawer, Grid, Layout, Menu, Space, Typography, theme } from 'antd';
import {
  ApiOutlined,
  BankOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  KeyOutlined,
  MenuOutlined,
  SettingOutlined,
  ShoppingCartOutlined,
  TagsOutlined,
  TeamOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiRequest } from '../../shared/api/client';
import { clearCurrentUserCache, useCurrentAdmin } from '../../shared/auth/current-user';
import { buildPaymentOrdersPath, type PaymentOrderPageDto } from '../../features/wallet/payment-api';
import { RouteTransition } from '../../shared/ui/route-transition';
import '../../shared/theme/tokens.css';

const { Sider, Header, Content } = Layout;
const { useBreakpoint } = Grid;
interface AdminNavItem {
  key: string;
  label: React.ReactNode;
}

const NAV_ICON_MAP: Record<string, React.ReactNode> = {
  '/admin/dashboard': <DashboardOutlined />,
  '/admin/brand': <TagsOutlined />,
  '/admin/tenants': <TeamOutlined />,
  '/admin/resellers': <TeamOutlined />,
  '/admin/users': <UserOutlined />,
  '/admin/wallet': <WalletOutlined />,
  '/admin/resources': <DatabaseOutlined />,
  '/admin/pricing': <TagsOutlined />,
  '/admin/orders': <ShoppingCartOutlined />,
  '/admin/proxies': <CloudServerOutlined />,
  '/admin/upstream': <ApiOutlined />,
  '/admin/providers': <BankOutlined />,
  '/admin/control-plane': <CloudServerOutlined />,
  '/admin/api-keys': <KeyOutlined />,
  '/admin/tickets': <SettingOutlined />,
  '/admin/site': <SettingOutlined />,
};

function findSelectedKey(items: AdminNavItem[], pathname: string): string {
  const match = items
    .map((item) => item.key)
    .filter((key) => pathname === key || pathname.startsWith(`${key}/`))
    .sort((a, b) => b.length - a.length)[0];
  return match ?? pathname;
}

export function AdminLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const currentAdmin = useCurrentAdmin();
  const { token } = theme.useToken();
  const screens = useBreakpoint();

  const [mobileOpen, setMobileOpen] = React.useState(false);
  const isMobile = !screens.lg;

  const ownerType = currentAdmin.data?.ownerType;
  const pendingPaymentsQuery = useQuery({
    queryKey: ['payments', 'pending-count'],
    queryFn: () => apiRequest<PaymentOrderPageDto>(buildPaymentOrdersPath({ page: 1, pageSize: 1, status: 'PENDING' })),
    enabled: ownerType === 'PLATFORM_ADMIN' || ownerType === 'TENANT_ADMIN',
    retry: false,
  });
  const pendingPaymentCount = pendingPaymentsQuery.data?.total ?? 0;

  const tenantItems: AdminNavItem[] = [
    { key: '/admin/users', label: t('nav.users') },
    { key: '/admin/payments', label: t('nav.payments') },
    { key: '/admin/orders', label: t('nav.orders') },
    { key: '/admin/resources', label: t('nav.resources') },
    { key: '/admin/pricing', label: t('nav.pricing') },
    { key: '/admin/providers', label: t('nav.providers') },
    { key: '/admin/control-plane', label: t('nav.controlPlane') },
    { key: '/admin/proxies', label: t('nav.proxies') },
    { key: '/admin/api-keys', label: t('nav.apiKeys') },
    { key: '/admin/tickets', label: t('nav.tickets') },
  ];
  const platformItems: AdminNavItem[] = [
    { key: '/admin/dashboard', label: t('nav.dashboard') },
    { key: '/admin/tenants', label: t('nav.tenants') },
    { key: '/admin/users', label: t('nav.users') },
    { key: '/admin/payments', label: t('nav.payments') },
    { key: '/admin/resources', label: t('nav.resources') },
    { key: '/admin/orders', label: t('nav.orders') },
    { key: '/admin/providers', label: t('nav.providers') },
    { key: '/admin/tickets', label: t('nav.tickets') },
    { key: '/admin/site', label: t('nav.site') },
  ];
  const rawMenuItems = !ownerType
    ? []
    : ownerType === 'TENANT_ADMIN'
    ? [
        { key: '/admin/dashboard', label: t('nav.dashboard') },
        { key: '/admin/brand', label: t('nav.brand') },
        ...tenantItems,
      ]
    : platformItems;
  const menuItems = rawMenuItems.map((item) => ({
    ...item,
    icon: NAV_ICON_MAP[item.key],
    className: 'ipx-nav-item',
    label: item.key === '/admin/payments' && pendingPaymentCount > 0
      ? (
          <span className="ipx-nav-label-with-badge">
            <span>{item.label}</span>
            <Badge count={pendingPaymentCount} size="small" overflowCount={99} />
          </span>
        )
      : item.label,
  }));

  const navMenu = (
    <Menu
      theme="light"
      selectedKeys={[findSelectedKey(rawMenuItems, location.pathname)]}
      items={menuItems}
      style={{ borderInlineEnd: 'none', background: 'transparent', padding: '12px' }}
      onClick={({ key }) => {
        setMobileOpen(false);
        if (key === location.pathname) return;
        void navigate({ to: key });
      }}
    />
  );

  const brandBlock = (
    <div className="ipx-sidebar-brand ipx-admin-sidebar-brand">
      <span aria-hidden className="ipx-admin-brand-logo">
        <img src="/images/ipipd/logo.svg" alt="" />
      </span>
      <Typography.Text className="ipx-admin-brand-label">
        {t('adminShell.badge')}
      </Typography.Text>
    </div>
  );

  const sidebarContent = (
    <>
      {brandBlock}
      {navMenu}
    </>
  );

  return (
    <Layout className="ipx-shell">
      {!isMobile && (
        <Sider
          theme="light"
          width={232}
          className="ipx-sidebar"
          style={{
            overflow: 'auto',
            height: '100vh',
            position: 'sticky',
            top: 0,
          }}
        >
          {sidebarContent}
        </Sider>
      )}

      <Drawer
        placement="left"
        open={isMobile && mobileOpen}
        onClose={() => setMobileOpen(false)}
        width={232}
        closable={false}
        rootClassName="ipx-admin-mobile-drawer"
        styles={{ body: { padding: 0, background: '#ffffff' } }}
      >
        {sidebarContent}
      </Drawer>

      <Layout>
        <Header
          className="ipx-header"
          style={{
            padding: isMobile ? '0 16px' : '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <Space size={12} align="center">
            {isMobile ? (
              <>
                <Button type="text" icon={<MenuOutlined />} onClick={() => setMobileOpen(true)} aria-label="menu" />
              </>
            ) : (
              <>
                <Button type="text" icon={<MenuOutlined />} aria-label="menu" />
              </>
            )}
          </Space>
          <Space size={isMobile ? 8 : 16} align="center">
            <Avatar
              size={30}
              style={{ background: token.colorPrimary, cursor: 'pointer', fontWeight: 700 }}
              onClick={() => {
                sessionStorage.removeItem('admin_token');
                clearCurrentUserCache('admin');
                void navigate({ to: '/admin/login' });
              }}
            >
              {t('logout').slice(0, 1).toUpperCase()}
            </Avatar>
            {!isMobile && (
              <Typography.Text
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  sessionStorage.removeItem('admin_token');
                  clearCurrentUserCache('admin');
                  void navigate({ to: '/admin/login' });
                }}
              >
                {t('logout')}
              </Typography.Text>
            )}
          </Space>
        </Header>

        <Content className="ipx-content" style={{ padding: isMobile ? 14 : '18px 18px 24px', background: token.colorBgLayout }}>
          <div className="ipx-content-inner" style={{ maxWidth: 1600 }}>
            <RouteTransition routeKey={location.pathname}>
              <Outlet />
            </RouteTransition>
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
