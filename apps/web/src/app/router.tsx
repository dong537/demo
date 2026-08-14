/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRouter, createRoute, createRootRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import type { AnyRoute } from '@tanstack/react-router';
import { ApiError } from '../shared/api/client';
import {
  clearCurrentUserCache,
  fetchCurrentAdmin,
  fetchCurrentCustomer,
} from '../shared/auth/current-user';
import type { CurrentUser } from '../shared/auth/current-user';

export const rootRoute = createRootRoute();

function lazyPage<T extends Record<string, unknown>, K extends keyof T>(
  importer: () => Promise<T>,
  exportName: K,
) {
  return lazyRouteComponent(importer, exportName);
}

function preloadInitialAdminRouteChunks() {
  if (typeof window === 'undefined') return;

  const pathname = window.location.pathname;
  if (pathname === '/admin/login') {
    void importAdminLogin();
    return;
  }

  if (pathname !== '/admin' && !pathname.startsWith('/admin/')) return;
  if (!sessionStorage.getItem('admin_token')) return;

  void importAdminLayout();

  if (pathname === '/admin' || pathname.startsWith('/admin/dashboard')) {
    void importAdminDashboard();
  } else if (pathname.startsWith('/admin/resources') || pathname.startsWith('/admin/pricing')) {
    void importAdminPricing();
  } else if (pathname.startsWith('/admin/users')) {
    void importAdminUsers();
  } else if (pathname.startsWith('/admin/providers')) {
    void importAdminProviders();
  } else if (pathname.startsWith('/admin/control-plane')) {
    void importAdminControlPlane();
  } else if (pathname.startsWith('/admin/orders')) {
    void importAdminOrders();
  }
}

const publicHomePage = lazyPage(() => import('../routes/public/home'), 'PublicHomePage');
const publicBuyPage = lazyPage(() => import('../routes/public/buy'), 'PublicBuyPage');
const publicTutorialArticlePage = lazyPage(
  () => import('../routes/public/tutorial-article'),
  'PublicTutorialArticlePage',
);
const publicTutorialCategoryPage = lazyPage(
  () => import('../routes/public/tutorial-article'),
  'PublicTutorialCategoryPage',
);
const publicNewsArticlePage = lazyPage(() => import('../routes/public/tutorial-article'), 'PublicNewsArticlePage');
const publicNewsCategoryPage = lazyPage(() => import('../routes/public/tutorial-article'), 'PublicNewsCategoryPage');
const publicTutorialsPage = lazyPage(() => import('../routes/public/official-pages'), 'PublicTutorialsPage');
const publicPromotionPage = lazyPage(() => import('../routes/public/official-pages'), 'PublicPromotionPage');
const publicFaqPage = lazyPage(() => import('../routes/public/official-pages'), 'PublicFaqPage');
const publicFaqProxySelectionPage = lazyPage(
  () => import('../routes/public/official-pages'),
  'PublicFaqProxySelectionPage',
);
const publicFaqUseCasesPage = lazyPage(() => import('../routes/public/official-pages'), 'PublicFaqUseCasesPage');
const publicPricingPage = lazyPage(() => import('../routes/public/official-pages'), 'PublicPricingPage');
const publicDynamicProductPage = lazyPage(() => import('../routes/public/official-pages'), 'PublicDynamicProductPage');
const publicAboutPage = lazyPage(() => import('../routes/public/official-pages'), 'PublicAboutPage');
const publicPartnersPage = lazyPage(() => import('../routes/public/official-pages'), 'PublicPartnersPage');
const publicNewsPage = lazyPage(() => import('../routes/public/official-pages'), 'PublicNewsPage');
const publicUserAgreementPage = lazyPage(() => import('../routes/public/official-pages'), 'PublicUserAgreementPage');
const publicPrivacyPolicyPage = lazyPage(() => import('../routes/public/official-pages'), 'PublicPrivacyPolicyPage');
const publicRefundPolicyPage = lazyPage(() => import('../routes/public/official-pages'), 'PublicRefundPolicyPage');
const importAdminLogin = () => import('../routes/admin/login');
const importAdminLayout = () => import('../routes/admin/_layout');
const importAdminDashboard = () => import('../routes/admin/dashboard/index');
const importAdminResources = () => import('../routes/admin/resources/index');
const importAdminPricing = () => import('../routes/admin/pricing/index');
const importAdminUsers = () => import('../routes/admin/users/index');
const importAdminProviders = () => import('../routes/admin/providers/index');
const importAdminControlPlane = () => import('../routes/admin/control-plane/index');
const importAdminOrders = () => import('../routes/admin/orders/index');
const adminLoginPage = lazyPage(importAdminLogin, 'AdminLoginPage');
const adminLayout = lazyPage(importAdminLayout, 'AdminLayout');
const customerLoginPage = lazyPage(() => import('../routes/customer/login'), 'CustomerLoginPage');
const customerRegisterPage = lazyPage(() => import('../routes/customer/register'), 'CustomerRegisterPage');
const customerLayout = lazyPage(() => import('../routes/customer/_layout'), 'CustomerLayout');
const customerDedicatedLinesPage = lazyPage(() => import('../routes/customer/dedicated-lines/index'), 'CustomerDedicatedLinesPage');

preloadInitialAdminRouteChunks();

export const publicHomeRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/',
  component: publicHomePage,
});

export const publicBuyRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/buy',
  component: publicBuyPage,
});

export const publicBuyAliasRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/public/buy',
  beforeLoad: () => {
    throw redirect({ href: '/buy' } as any);
  },
});

export const publicTutorialTuiguangRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/tutorials/article/tuiguang',
  component: publicTutorialArticlePage,
});

export const publicTutorialArticleRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/tutorials/article/$slug',
  component: publicTutorialArticlePage,
});

export const publicTutorialCategoryRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/tutorials/category/$slug',
  component: publicTutorialCategoryPage,
});

export const publicTutorialsRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/tutorials',
  component: publicTutorialsPage,
});

export const publicPromotionRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/promotion',
  component: publicPromotionPage,
});

export const publicFaqRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/faq',
  component: publicFaqPage,
});

export const publicFaqProxySelectionRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/faq/proxy-selection',
  component: publicFaqProxySelectionPage,
});

export const publicFaqUseCasesRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/faq/use-cases',
  component: publicFaqUseCasesPage,
});

export const publicPricingRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/pricing',
  component: publicPricingPage,
});

export const publicDynamicProductRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/products/dynamic',
  component: publicDynamicProductPage,
});

export const publicAboutRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/about',
  component: publicAboutPage,
});

export const publicPartnersRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/partners',
  component: publicPartnersPage,
});

export const publicNewsRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/news',
  component: publicNewsPage,
});

export const publicNewsArticleRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/news/article/$slug',
  component: publicNewsArticlePage,
});

export const publicNewsCategoryRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/news/category/$slug',
  component: publicNewsCategoryPage,
});

export const publicUserAgreementRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/user-agreement',
  component: publicUserAgreementPage,
});

export const publicPrivacyPolicyRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/privacy-policy',
  component: publicPrivacyPolicyPage,
});

export const publicRefundPolicyRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/refund-policy',
  component: publicRefundPolicyPage,
});

export const publicLegacyNewsArticleRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/news_article_$slug',
  component: publicNewsArticlePage,
});

export const publicLegacyTutorialArticleRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/tutorials_article_$slug',
  component: publicTutorialArticlePage,
});

export const publicLegacyNewsCategoryRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/news_category_$slug',
  component: publicNewsCategoryPage,
});

export const publicLegacyTutorialCategoryRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/tutorials_category_$slug',
  component: publicTutorialCategoryPage,
});

export const publicEnHomeRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/en-US',
  component: publicHomePage,
});

export const publicEnPricingRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/en-US/pricing',
  component: publicPricingPage,
});

export const publicEnPromotionRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/en-US/promotion',
  component: publicPromotionPage,
});

export const publicEnFaqRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/en-US/faq',
  component: publicFaqPage,
});

export const publicEnFaqProxySelectionRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/en-US/faq/proxy-selection',
  component: publicFaqProxySelectionPage,
});

export const publicEnFaqUseCasesRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/en-US/faq/use-cases',
  component: publicFaqUseCasesPage,
});

export const publicEnNewsRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/en-US/news',
  component: publicNewsPage,
});

export const publicEnNewsArticleRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/en-US/news/article/$slug',
  component: publicNewsArticlePage,
});

export const publicEnTutorialsRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/en-US/tutorials',
  component: publicTutorialsPage,
});

export const publicEnTutorialArticleRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/en-US/tutorials/article/$slug',
  component: publicTutorialArticlePage,
});

export const publicEnTutorialCategoryRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/en-US/tutorials/category/$slug',
  component: publicTutorialCategoryPage,
});

export const adminLoginRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/admin/login',
  component: adminLoginPage,
});

export const adminLayoutRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/admin',
  component: adminLayout,
  beforeLoad: () => {
    if (!sessionStorage.getItem('admin_token')) {
      throw redirect({ href: '/admin/login' } as any);
    }
  },
});

const adminIndexRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/',
  beforeLoad: async () => {
    await requireAdmin();
    throw redirect({ href: '/admin/dashboard' } as any);
  },
});

const adminDashboardRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/dashboard',
  beforeLoad: () => requireAdminRole(['TENANT_ADMIN', 'PLATFORM_ADMIN']),
  component: lazyPage(importAdminDashboard, 'AdminDashboardPage'),
});

const adminBrandRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/brand',
  beforeLoad: () => requireAdminRole(['TENANT_ADMIN']),
  component: lazyPage(() => import('../routes/admin/brand/index'), 'AdminBrandPage'),
});

const usersRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/users',
  component: lazyPage(importAdminUsers, 'UsersPage'),
});

const walletRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/wallet',
  component: lazyPage(() => import('../routes/admin/wallet/index'), 'WalletPage'),
});

const paymentsRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/payments',
  component: lazyPage(() => import('../routes/admin/payments/index'), 'PaymentsPage'),
});

const auditRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/audit',
  component: lazyPage(() => import('../routes/admin/audit/index'), 'AuditPage'),
});

const adminResourcesRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/resources',
  beforeLoad: () => requireAdminRole(['PLATFORM_ADMIN']),
  component: lazyPage(importAdminResources, 'AdminResourcesPage'),
});

const adminPricingRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/pricing',
  beforeLoad: () => requireAdminRole(['PLATFORM_ADMIN']),
  component: lazyPage(importAdminPricing, 'AdminPricingPage'),
});

const adminOrdersRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/orders',
  component: lazyPage(importAdminOrders, 'AdminOrdersPage'),
});

const adminProxiesRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/proxies',
  component: lazyPage(() => import('../routes/admin/proxies/index'), 'AdminProxiesPage'),
});

const adminTenantsRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/tenants',
  beforeLoad: () => requireAdminRole(['PLATFORM_ADMIN']),
  component: lazyPage(() => import('../routes/admin/tenants/index'), 'AdminTenantsPage'),
});

const adminTenantCreateRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/tenants/new',
  beforeLoad: () => requireAdminRole(['PLATFORM_ADMIN']),
  component: lazyPage(() => import('../routes/admin/tenants/new'), 'AdminTenantCreatePage'),
});

const adminTenantDetailRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/tenants/$tenantId',
  beforeLoad: () => requireAdminRole(['PLATFORM_ADMIN']),
  component: lazyPage(() => import('../routes/admin/tenants/$tenantId'), 'AdminTenantDetailPage'),
});

const adminTenantBrandRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/tenants/$tenantId/brand',
  beforeLoad: () => requireAdminRole(['PLATFORM_ADMIN']),
  component: lazyPage(() => import('../routes/admin/tenants/$tenantId.brand'), 'AdminTenantBrandPage'),
});

const adminResellersRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/resellers',
  beforeLoad: () => requireAdminRole(['PLATFORM_ADMIN']),
  component: lazyPage(() => import('../routes/admin/resellers/index'), 'AdminResellersPage'),
});

const adminResellerCreateRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/resellers/new',
  beforeLoad: () => requireAdminRole(['PLATFORM_ADMIN']),
  component: lazyPage(() => import('../routes/admin/resellers/new'), 'AdminResellerCreatePage'),
});

const adminResellerDetailRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/resellers/$tenantId',
  beforeLoad: () => requireAdminRole(['PLATFORM_ADMIN']),
  component: lazyPage(() => import('../routes/admin/resellers/$tenantId'), 'AdminResellerDetailPage'),
});

const adminResellerBrandRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/resellers/$tenantId/brand',
  beforeLoad: () => requireAdminRole(['PLATFORM_ADMIN']),
  component: lazyPage(() => import('../routes/admin/resellers/$tenantId.brand'), 'AdminResellerBrandPage'),
});

const adminSiteRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/site',
  beforeLoad: () => requireAdminRole(['PLATFORM_ADMIN']),
  component: lazyPage(() => import('../routes/admin/site/index'), 'AdminSitePage'),
});

const adminUpstreamRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/upstream',
  beforeLoad: () => requireAdminRole(['PLATFORM_ADMIN']),
  component: lazyPage(() => import('../routes/admin/upstream/index'), 'AdminUpstreamPage'),
});

const adminApiKeysRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/api-keys',
  beforeLoad: () => requireAdminRole(['TENANT_ADMIN']),
  component: lazyPage(() => import('../routes/admin/api-keys/index'), 'AdminApiKeysPage'),
});

const adminRequestLogsRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/request-logs',
  beforeLoad: () => requireAdminRole(['PLATFORM_ADMIN']),
  component: lazyPage(() => import('../routes/admin/request-logs/index'), 'AdminRequestLogsPage'),
});

const adminTicketsRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/tickets',
  beforeLoad: () => requireAdminRole(['PLATFORM_ADMIN', 'TENANT_ADMIN']),
  component: lazyPage(() => import('../routes/admin/tickets/index'), 'AdminTicketsPage'),
});

const adminProvidersRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/providers',
  beforeLoad: () => requireAdminRole(['PLATFORM_ADMIN']),
  component: lazyPage(importAdminProviders, 'AdminProvidersPage'),
});

const adminTicketDetailRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/tickets/$ticketId',
  beforeLoad: () => requireAdminRole(['PLATFORM_ADMIN', 'TENANT_ADMIN']),
  component: lazyPage(() => import('../routes/admin/tickets/$ticketId'), 'AdminTicketDetailPage'),
});

export const customerLoginRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/login',
  component: customerLoginPage,
});

export const customerRegisterRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  path: '/register',
  component: customerRegisterPage,
});

async function requireAdmin(): Promise<CurrentUser> {
  try {
    return await fetchCurrentAdmin();
  } catch (e) {
    if (e instanceof ApiError && (e.code === 0 || e.reasonKey === 'network_error')) {
      throw e;
    }
    sessionStorage.removeItem('admin_token');
    clearCurrentUserCache('admin');
    throw redirect({ href: '/admin/login' } as any);
  }
}

async function requireAdminRole(allowed: CurrentUser['ownerType'][]): Promise<void> {
  const current = await requireAdmin();
  if (!allowed.includes(current.ownerType)) {
    throw redirect({ href: current.ownerType === 'TENANT_ADMIN' ? '/admin/dashboard' : '/admin/resellers' } as any);
  }
}

export const customerLayoutRoute = createRoute({
  getParentRoute: () => rootRoute as AnyRoute,
  id: 'customer-layout',
  component: customerLayout,
  beforeLoad: async () => {
    if (!sessionStorage.getItem('user_token')) {
      throw redirect({ href: '/login' } as any);
    }
    try {
      await fetchCurrentCustomer();
    } catch (e) {
      if (e instanceof ApiError && (e.code === 0 || e.reasonKey === 'network_error')) {
        return;
      }
      sessionStorage.removeItem('user_token');
      clearCurrentUserCache('customer');
      throw redirect({ href: '/login' } as any);
    }
  },
});

const customerOverviewRoute = createRoute({
  getParentRoute: () => customerLayoutRoute as AnyRoute,
  path: '/overview',
  component: lazyPage(() => import('../routes/customer/overview'), 'CustomerOverviewPage'),
});

const customerWalletRoute = createRoute({
  getParentRoute: () => customerLayoutRoute as AnyRoute,
  path: '/wallet',
  component: lazyPage(() => import('../routes/customer/wallet/index'), 'CustomerWalletPage'),
});

const customerTopupRoute = createRoute({
  getParentRoute: () => customerLayoutRoute as AnyRoute,
  path: '/wallet/topup',
  component: lazyPage(() => import('../routes/customer/wallet/topup'), 'CustomerTopupPage'),
});

const customerProxiesRoute = createRoute({
  getParentRoute: () => customerLayoutRoute as AnyRoute,
  path: '/proxies',
  component: lazyPage(() => import('../routes/customer/proxies/index'), 'CustomerProxiesPage'),
});

const adminControlPlaneRoute = createRoute({
  getParentRoute: () => adminLayoutRoute as AnyRoute,
  path: '/control-plane',
  beforeLoad: () => requireAdminRole(['PLATFORM_ADMIN']),
  component: lazyPage(importAdminControlPlane, 'AdminControlPlanePage'),
});

const customerDedicatedLinesRoute = createRoute({
  getParentRoute: () => customerLayoutRoute as AnyRoute,
  path: '/dedicated-lines',
  component: customerDedicatedLinesPage,
});

const customerBuyRoute = createRoute({
  getParentRoute: () => customerLayoutRoute as AnyRoute,
  path: '/customer/buy',
  component: lazyPage(() => import('../routes/customer/buy/index'), 'CustomerBuyPage'),
});

const customerApiKeysRoute = createRoute({
  getParentRoute: () => customerLayoutRoute as AnyRoute,
  path: '/api-keys',
  component: lazyPage(() => import('../routes/customer/api-keys/index'), 'CustomerApiKeysPage'),
});

const customerTicketsRoute = createRoute({
  getParentRoute: () => customerLayoutRoute as AnyRoute,
  path: '/tickets',
  component: lazyPage(() => import('../routes/customer/tickets/index'), 'CustomerTicketsPage'),
});

const customerTicketDetailRoute = createRoute({
  getParentRoute: () => customerLayoutRoute as AnyRoute,
  path: '/tickets/$ticketId',
  component: lazyPage(() => import('../routes/customer/tickets/$ticketId'), 'CustomerTicketDetailPage'),
});

const customerProxyCheckRoute = createRoute({
  getParentRoute: () => customerLayoutRoute as AnyRoute,
  path: '/proxy-check',
  component: lazyPage(() => import('../routes/customer/proxy-check/index'), 'CustomerProxyCheckPage'),
});

const customerAccountRoute = createRoute({
  getParentRoute: () => customerLayoutRoute as AnyRoute,
  path: '/account',
  component: lazyPage(() => import('../routes/customer/account/index'), 'CustomerAccountPage'),
});

const customerResellerRoute = createRoute({
  getParentRoute: () => customerLayoutRoute as AnyRoute,
  path: '/reseller',
  component: lazyPage(() => import('../routes/customer/reseller/index'), 'CustomerResellerPage'),
});

const customerResellerUsersRoute = createRoute({
  getParentRoute: () => customerLayoutRoute as AnyRoute,
  path: '/reseller/users',
  component: lazyPage(() => import('../routes/customer/reseller/users'), 'CustomerResellerUsersPage'),
});

const customerResellerProductsRoute = createRoute({
  getParentRoute: () => customerLayoutRoute as AnyRoute,
  path: '/reseller/products',
  component: lazyPage(() => import('../routes/customer/reseller/products'), 'CustomerResellerProductsPage'),
});

const customerResellerPricingRoute = createRoute({
  getParentRoute: () => customerLayoutRoute as AnyRoute,
  path: '/reseller/pricing',
  component: lazyPage(() => import('../routes/customer/reseller/pricing'), 'CustomerResellerPricingPage'),
});

const customerResellerOrdersRoute = createRoute({
  getParentRoute: () => customerLayoutRoute as AnyRoute,
  path: '/reseller/orders',
  component: lazyPage(() => import('../routes/customer/reseller/orders'), 'CustomerResellerOrdersPage'),
});

const customerResellerConnectionsRoute = createRoute({
  getParentRoute: () => customerLayoutRoute as AnyRoute,
  path: '/reseller/connections',
  component: lazyPage(() => import('../routes/customer/reseller/connections'), 'CustomerResellerConnectionsPage'),
});

const routeTree = rootRoute.addChildren([
  publicHomeRoute,
  publicBuyRoute,
  publicBuyAliasRoute,
  publicTutorialsRoute,
  publicTutorialTuiguangRoute,
  publicTutorialArticleRoute,
  publicTutorialCategoryRoute,
  publicPromotionRoute,
  publicFaqRoute,
  publicFaqProxySelectionRoute,
  publicFaqUseCasesRoute,
  publicPricingRoute,
  publicDynamicProductRoute,
  publicAboutRoute,
  publicPartnersRoute,
  publicNewsRoute,
  publicNewsArticleRoute,
  publicNewsCategoryRoute,
  publicUserAgreementRoute,
  publicPrivacyPolicyRoute,
  publicRefundPolicyRoute,
  publicLegacyNewsArticleRoute,
  publicLegacyTutorialArticleRoute,
  publicLegacyNewsCategoryRoute,
  publicLegacyTutorialCategoryRoute,
  publicEnHomeRoute,
  publicEnPricingRoute,
  publicEnPromotionRoute,
  publicEnFaqRoute,
  publicEnFaqProxySelectionRoute,
  publicEnFaqUseCasesRoute,
  publicEnNewsRoute,
  publicEnNewsArticleRoute,
  publicEnTutorialsRoute,
  publicEnTutorialArticleRoute,
  publicEnTutorialCategoryRoute,
  adminLoginRoute,
  adminLayoutRoute.addChildren([
    adminIndexRoute,
    adminDashboardRoute,
    adminBrandRoute,
    usersRoute,
    walletRoute,
    paymentsRoute,
    auditRoute,
    adminResourcesRoute,
    adminPricingRoute,
    adminOrdersRoute,
    adminProxiesRoute,
    adminTenantsRoute,
    adminTenantCreateRoute,
    adminTenantDetailRoute,
    adminTenantBrandRoute,
    adminResellersRoute,
    adminResellerCreateRoute,
    adminResellerDetailRoute,
    adminResellerBrandRoute,
    adminSiteRoute,
    adminUpstreamRoute,
    adminApiKeysRoute,
    adminRequestLogsRoute,
    adminTicketsRoute,
    adminProvidersRoute,
    adminControlPlaneRoute,
    adminTicketDetailRoute,
  ]),
  customerLoginRoute,
  customerRegisterRoute,
  customerLayoutRoute.addChildren([
    customerOverviewRoute,
    customerBuyRoute,
  customerProxiesRoute,
  customerDedicatedLinesRoute,
    customerApiKeysRoute,
    customerTicketsRoute,
    customerTicketDetailRoute,
    customerProxyCheckRoute,
    customerWalletRoute,
    customerTopupRoute,
    customerAccountRoute,
    customerResellerRoute,
    customerResellerUsersRoute,
    customerResellerProductsRoute,
    customerResellerPricingRoute,
    customerResellerOrdersRoute,
    customerResellerConnectionsRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
