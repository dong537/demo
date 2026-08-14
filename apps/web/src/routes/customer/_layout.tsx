import React from 'react';
import { Avatar, Button, Drawer, Dropdown, Grid, Layout, Menu, Space, Typography, theme } from 'antd';
import {
  DashboardOutlined,
  ShoppingCartOutlined,
  CloudOutlined,
  DeploymentUnitOutlined,
  SafetyCertificateOutlined,
  KeyOutlined,
  WalletOutlined,
  PlusCircleOutlined,
  MessageOutlined,
  UserOutlined,
  MenuOutlined,
  ShopOutlined,
  TeamOutlined,
  TagsOutlined,
  FileTextOutlined,
  AppstoreOutlined,
  DownOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Outlet, useNavigate, useLocation } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { NotificationCenter } from '../../features/customer-notifications/notification-center.feature';
import { useSiteBrand } from '../../shared/site/use-site-brand';
import { DEFAULT_BRAND_NAME } from '../../shared/site/brand-display';
import { clearCurrentUserCache, useCurrentCustomer } from '../../shared/auth/current-user';
import { userApiRequest } from '../../shared/api/client';
import { RouteTransition } from '../../shared/ui/route-transition';
import { formatMoneyAmount } from '../../shared/money/money';
import '../../shared/theme/tokens.css';

interface WalletDto {
  available: string;
  currency: string;
}

const { Sider, Header, Content } = Layout;
const { useBreakpoint } = Grid;
const DEFAULT_BRAND = DEFAULT_BRAND_NAME;

const NAV_ICON_MAP: Record<string, React.ReactNode> = {
  '/overview': <DashboardOutlined style={{ fontSize: 16 }} />,
  '/customer/buy': <ShoppingCartOutlined style={{ fontSize: 16 }} />,
  '/proxies': <CloudOutlined style={{ fontSize: 16 }} />,
  '/dedicated-lines': <DeploymentUnitOutlined style={{ fontSize: 16 }} />,
  '/proxy-check': <SafetyCertificateOutlined style={{ fontSize: 16 }} />,
  '/api-keys': <KeyOutlined style={{ fontSize: 16 }} />,
  '/wallet': <WalletOutlined style={{ fontSize: 16 }} />,
  '/wallet/topup': <PlusCircleOutlined style={{ fontSize: 16 }} />,
  '/reseller': <ShopOutlined style={{ fontSize: 16 }} />,
  '/reseller/users': <TeamOutlined style={{ fontSize: 16 }} />,
  '/reseller/products': <AppstoreOutlined style={{ fontSize: 16 }} />,
  '/reseller/pricing': <TagsOutlined style={{ fontSize: 16 }} />,
  '/reseller/orders': <FileTextOutlined style={{ fontSize: 16 }} />,
  '/reseller/connections': <GlobalOutlined style={{ fontSize: 16 }} />,
  '/tickets': <MessageOutlined style={{ fontSize: 16 }} />,
  '/account': <UserOutlined style={{ fontSize: 16 }} />,
};

interface NavLeaf {
  key: string;
  labelKey: string;
}

interface NavSubmenu {
  key: string;
  labelKey: string;
  icon?: React.ReactNode;
  children: NavLeaf[];
}

interface NavGroup {
  groupKey: string;
  items: Array<NavLeaf | NavSubmenu>;
}

const RESELLER_ROOT_KEY = '/reseller-root';

const NAV_GROUPS: NavGroup[] = [
  {
    groupKey: 'workspace',
    items: [{ key: '/overview', labelKey: 'customer.nav.overview' }],
  },
  {
    groupKey: 'proxies',
    items: [
      { key: '/customer/buy', labelKey: 'customer.nav.buy' },
      { key: '/dedicated-lines', labelKey: 'customer.nav.dedicatedLines' },
      { key: '/proxies', labelKey: 'customer.nav.proxies' },
      { key: '/proxy-check', labelKey: 'customer.nav.proxyCheck' },
      { key: '/api-keys', labelKey: 'customer.nav.apiKeys' },
    ],
  },
  {
    groupKey: 'billing',
    items: [
      { key: '/wallet', labelKey: 'customer.nav.wallet' },
      { key: '/wallet/topup', labelKey: 'customer.nav.topup' },
    ],
  },
  {
    groupKey: 'reseller',
    items: [
      {
        key: RESELLER_ROOT_KEY,
        labelKey: 'customer.nav.reseller',
        icon: <ShopOutlined style={{ fontSize: 16 }} />,
        children: [
          { key: '/reseller', labelKey: 'customer.nav.resellerOverview' },
          { key: '/reseller/users', labelKey: 'customer.nav.resellerUsers' },
          { key: '/reseller/products', labelKey: 'customer.nav.resellerProducts' },
          { key: '/reseller/pricing', labelKey: 'customer.nav.resellerPricing' },
          { key: '/reseller/orders', labelKey: 'customer.nav.resellerOrders' },
          { key: '/reseller/connections', labelKey: 'customer.nav.resellerConnections' },
        ],
      },
    ],
  },
  {
    groupKey: 'support',
    items: [
      { key: '/tickets', labelKey: 'customer.nav.tickets' },
      { key: '/account', labelKey: 'customer.nav.account' },
    ],
  },
];

const CUSTOMER_NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

function selectKey(pathname: string): string {
  const flat = CUSTOMER_NAV_ITEMS.flatMap((item) => 'children' in item ? [item.key, ...item.children.map((child) => child.key)] : [item.key]);
  const match = flat
    .filter((key) => key !== RESELLER_ROOT_KEY && (pathname === key || pathname.startsWith(`${key}/`)))
    .sort((a, b) => b.length - a.length)[0];
  return match ?? pathname;
}

function openKeysForPath(pathname: string): string[] {
  return pathname === '/reseller' || pathname.startsWith('/reseller/') ? [RESELLER_ROOT_KEY] : [];
}

export function CustomerLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();
  const brandQuery = useSiteBrand();
  const currentQuery = useCurrentCustomer();
  const screens = useBreakpoint();

  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [openNavKeys, setOpenNavKeys] = React.useState<string[]>(() => openKeysForPath(location.pathname));
  const isMobile = !screens.lg;

  React.useEffect(() => {
    if (location.pathname === '/reseller' || location.pathname.startsWith('/reseller/')) {
      setOpenNavKeys((keys) => keys.includes(RESELLER_ROOT_KEY) ? keys : [...keys, RESELLER_ROOT_KEY]);
    }
  }, [location.pathname]);

  const userId = currentQuery.data?.ownerId ?? '';
  const walletQuery = useQuery({
    queryKey: ['customer-wallet', userId],
    queryFn: () => userApiRequest<WalletDto>(`/api/wallet/${encodeURIComponent(userId)}`),
    enabled: !!userId,
  });

  const brandName = brandQuery.data?.name || DEFAULT_BRAND;
  const hideBrandName = brandName === DEFAULT_BRAND || brandName.toLowerCase() === 'ipeasy';
  const accountLabel = t('customer.nav.account');
  const languageLabel = t('customer.shell.language');
  const selectedNavKey = selectKey(location.pathname);
  const selectedNavItem = CUSTOMER_NAV_ITEMS
    .flatMap((item) => 'children' in item ? [item, ...item.children] : [item])
    .find((item) => item.key === selectedNavKey);
  const pageTitle = selectedNavItem ? t(selectedNavItem.labelKey) : brandName;
  const sidebarBalance = walletQuery.isLoading || walletQuery.isError
    ? t('customer.wallet.balanceUnavailable')
    : (formatCustomerWalletMoneyAmount(walletQuery.data?.available ?? '', walletQuery.data?.currency ?? '') ?? t('customer.wallet.balanceUnavailable'));

  const menuItems = CUSTOMER_NAV_ITEMS.map((item) => {
    if ('children' in item) {
      return {
        key: item.key,
        label: t(item.labelKey),
        icon: item.icon,
        className: 'ipx-nav-submenu',
        children: item.children.map((child) => ({
          key: child.key,
          label: t(child.labelKey),
          icon: NAV_ICON_MAP[child.key],
          className: 'ipx-nav-item',
        })),
      };
    }
    return {
      key: item.key,
      label: t(item.labelKey),
      icon: NAV_ICON_MAP[item.key],
      className: 'ipx-nav-item',
    };
  });

  const logout = () => {
    sessionStorage.removeItem('user_token');
    clearCurrentUserCache('customer');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void navigate({ to: '/login' } as any);
  };

  const handleNavigate = (key: string) => {
    setMobileOpen(false);
    if (key === location.pathname) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void navigate({ to: key } as any);
  };

  const brandMark = (
    <Space className="ipx-customer-brand" size={10} align="center">
      <span aria-hidden className="ipx-customer-brand-logo">
        <img src="/images/ipipd/logo.svg" alt="" />
      </span>
      <Typography.Text className="ipx-brand-name" style={{ color: 'var(--ipx-primary, #003afe)', display: hideBrandName ? 'none' : undefined }}>
        {brandName}
      </Typography.Text>
    </Space>
  );

  const balanceBlock = (
    <>
      <div className="ipx-customer-balance">
        <div className="ipx-customer-balance-label">
          {t('customer.wallet.balanceLabel')}
        </div>
        <div className="ipx-customer-balance-row">
          <span className="ipx-customer-balance-amount">
            {sidebarBalance}
          </span>
          <button
            className="ipx-customer-balance-topup"
            type="button"
            onClick={() => handleNavigate('/wallet/topup')}
          >
            {t('customer.nav.topup')}
          </button>
        </div>
      </div>
      <div className="ipx-customer-sidebar-divider" />
    </>
  );

  const navMenu = (
    <Menu
      theme="light"
      mode="inline"
      selectedKeys={[selectedNavKey]}
      openKeys={openNavKeys}
      onOpenChange={setOpenNavKeys}
      items={menuItems}
      style={{ borderInlineEnd: 'none', background: 'transparent', padding: '12px 12px 18px' }}
      onClick={({ key }) => handleNavigate(key)}
    />
  );

  const sidebarContent = (
    <>
      <div className="ipx-customer-sidebar-brand">
        {brandMark}
      </div>
      {balanceBlock}
      {navMenu}
    </>
  );

  const accountMenu = (
    <Dropdown
      placement="bottomRight"
      overlayClassName="ipx-customer-account-menu"
      menu={{
        items: [
          { key: 'account', label: t('customer.nav.account') },
          { type: 'divider' as const },
          { key: 'logout', label: t('logout'), danger: true },
        ],
        onClick: ({ key }) => {
          if (key === 'logout') logout();
          else handleNavigate('/account');
        },
      }}
      trigger={['click']}
    >
      <Space className="ipx-customer-account-trigger" size={8} align="center">
        <Avatar className="ipx-customer-account-avatar" size={28} style={{ background: token.colorPrimary }}>
          {accountLabel.slice(0, 1).toUpperCase()}
        </Avatar>
        {!isMobile && (
          <span className="ipx-customer-account-meta">
            <Typography.Text className="ipx-customer-account-name">{accountLabel}</Typography.Text>
            <Typography.Text className="ipx-customer-account-id" type="secondary">
              {currentQuery.data?.ownerId ? currentQuery.data.ownerId.slice(0, 8) : '--'}
            </Typography.Text>
          </span>
        )}
        {!isMobile && <DownOutlined className="ipx-customer-account-caret" />}
      </Space>
    </Dropdown>
  );

  return (
    <Layout className="ipx-shell ipx-customer-shell">
      {!isMobile && (
        <Sider
          theme="light"
          width={232}
          trigger={null}
          className="ipx-sidebar ipx-customer-sidebar"
          style={{
            overflow: 'auto',
            height: '100vh',
            position: 'sticky',
            top: 0,
            minWidth: 232,
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
        rootClassName="ipx-customer-mobile-drawer"
        styles={{ body: { padding: 0, background: '#ffffff' } }}
      >
        {sidebarContent}
      </Drawer>

      <Layout className="ipx-customer-main">
        <Header
          className="ipx-header ipx-customer-header"
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
            {isMobile && (
              <Button
                type="text"
                size="small"
                className="ipx-customer-mobile-menu"
                icon={<MenuOutlined />}
                onClick={() => setMobileOpen(true)}
                aria-label="menu"
                style={{ width: 34, height: 34 }}
              />
            )}
            {isMobile ? brandMark : (
              <Typography.Text strong className="ipx-customer-page-title">
                {pageTitle}
              </Typography.Text>
            )}
          </Space>
          <Space className="ipx-customer-header-actions" size={isMobile ? 6 : 8} align="center">
            <NotificationCenter />
            {!isMobile && (
              <span className="ipx-customer-language" aria-label={languageLabel}>
                <GlobalOutlined />
                <span>{languageLabel}</span>
              </span>
            )}
            <Button
              type="text"
              size={isMobile ? 'small' : 'middle'}
              className="ipx-customer-header-topup"
              style={{ paddingInline: isMobile ? 8 : 12 }}
              onClick={() => handleNavigate('/wallet/topup')}
            >
              {t('customer.nav.topup')}
            </Button>
            {accountMenu}
          </Space>
        </Header>

        <Content className="ipx-content ipx-customer-content" style={{ padding: isMobile ? 14 : 18, background: '#fafafc' }}>
          <div className="ipx-content-inner ipx-customer-content-inner">
            <RouteTransition routeKey={location.pathname}>
              <Outlet />
            </RouteTransition>
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}

export function formatCustomerWalletMoneyAmount(value: string | number | null | undefined, currency?: string | null): string | null {
  const formatted = formatMoneyAmount(value, currency ?? 'CNY');
  if (!formatted) return null;
  return formatted.replace(/\sCNY$/i, ' 元');
}
