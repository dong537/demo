# Task 15: 多租户数据隔离强化

## 目标
强化 API 层的租户边界校验，确保 TENANT_ADMIN 和 USER 无法跨租户访问数据。

## 实现内容

### 1. tenant-guard.ts
创建 `apps/api/src/common/auth/tenant-guard.ts`，提供 `assertTenantAccess` 函数。

### 2. Use Case 加固
在以下 use case 中调用 `assertTenantAccess`：
- wallet: get-wallet, list-ledger, adjust-wallet
- payments: confirm-payment-order
- orders: create-static-proxy-order

### 3. TenantsModule
- `GET /api/tenants` — 列出租户（PLATFORM_ADMIN 全部，TENANT_ADMIN 只看自己）
- `POST /api/tenants` — 创建租户（PLATFORM_ADMIN）
- `GET /api/tenants/:id` — 租户详情（客户数、余额汇总、订单数）
- `PUT /api/tenants/:id/status` — 暂停/恢复租户（PLATFORM_ADMIN）
