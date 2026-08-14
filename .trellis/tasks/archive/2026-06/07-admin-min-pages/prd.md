# Task 07 — Admin 最小页面

## 目标

建立前端 React + Vite 骨架，实现 Admin surface 5 个最小页面，所有数据来自真实 API（无假数据），所有列表有 loading / empty / error / pagination 状态。

## 实现要求

### 前端骨架

**vite.config.ts**
- 插件：`@vitejs/plugin-react`
- server proxy：`/api` → `WEB_API_PROXY_TARGET`（环境变量）
- build output：`dist/`

**依赖（关键）**
```json
{
  "@tanstack/react-router": "^1",
  "@tanstack/react-query": "^5",
  "antd": "^5",
  "react-hook-form": "^7",
  "zod": "^3",
  "@hookform/resolvers": "^3",
  "i18next": "^23",
  "react-i18next": "^14",
  "@ipeasy/contracts": "workspace:*"
}
```

**src/shared/api/client.ts**
- 基于 `fetch` 封装，添加 `Authorization: Bearer <token>` header（从 sessionStorage 读）
- 返回统一 envelope 类型；`code !== 0` 时 throw `ApiError(code, reasonKey, details)`
- 前端 `ApiError` 类可被 TanStack Query 的 `onError` 识别

**src/app/providers.tsx**
- 包含：`QueryClientProvider`、`RouterProvider`、`ConfigProvider`（Ant Design token 主色 `#0040ff`）、i18n provider

**src/shared/i18n/zh.ts 和 en.ts**
- 覆盖所有 Admin 页面可见文案（页面标题、列头、按钮、错误提示、空状态）
- 禁止在组件里硬编码中文

### 路由结构（TanStack Router file-based）

```
/admin/login             → 未登录入口
/admin                   → 需要 AdminAuth guard（无 session → redirect login）
/admin/users             → 用户列表
/admin/wallet            → 钱包流水（选择用户后展示）
/admin/payments          → 支付单列表
/admin/audit             → 审计日志
```

路由守卫：`beforeLoad` 检查 sessionStorage 中 admin token 有效性，无效 → redirect `/admin/login`。

### 各页面实现要求

**AdminLogin（features/auth/admin-login.feature.tsx）**
- Form：email、password、Submit
- React Hook Form + Zod 校验（email 格式、password 非空）
- 提交调用 `POST /api/auth/login`，成功后 token 存 sessionStorage，redirect `/admin`
- 错误状态：invalid credentials 显示 "邮箱或密码错误"，network error 显示通用错误

**UserList（features/admin-users/user-list.feature.tsx）**
- 调用 `GET /api/users`（Admin guard）
- Table：email、tenantId、status、kycStatus、createdAt、操作列
- Toolbar：search by email、status filter、pageSize selector
- 状态：loading skeleton、empty 插图+文案、error Alert（显示 reasonKey）、permission denied Alert
- 分页：受控，显示 total

**LedgerList（features/wallet/ledger-list.feature.tsx）**
- URL param：`userId`
- 调用 `GET /api/wallet/:userId/ledger`
- Table：type、amount（正负标色）、balanceAfter、reason、createdAt
- type filter、date range filter（from/to）
- 同样具备 loading/empty/error/permission 状态

**PaymentList（features/wallet/payment-list.feature.tsx）**
- 调用 `GET /api/payments`（Admin）
- Table：id（截断）、userId、amount、channel、status、createdAt、操作列
- status filter、channel filter
- 操作：PENDING 状态显示"确认"按钮 → 打开 Modal（reason 输入框）→ 调用 `POST /api/payments/:id/confirm`
- 确认 Modal：必须有 reason 字段（非空）、提交中 loading、成功 toast + 刷新列表、失败显示 reasonKey

**AuditLogList（features/audit/audit-log-list.feature.tsx）**
- 调用 `GET /api/audit` （Admin guard）
- Table：action、actorType、actorId、targetType、targetId、requestId（截断）、createdAt
- action filter、actorType filter、date range
- 只读，无操作按钮

### 公共组件规范（src/shared/ui/）

所有列表页必须使用统一 wrapper：

```tsx
// <ListPage> 封装 loading / error / empty / permission
interface ListPageProps<T> {
  query: UseQueryResult<PageResult<T>>;
  columns: ColumnsType<T>;
  toolbar?: ReactNode;
  pagination: { page; pageSize; total; onChange };
}
```

高危 Modal（confirm payment）必须封装为独立组件，包含 reason input + confirm 按钮 + loading 状态。

## 验证步骤

```bash
pnpm --filter @ipeasy/web typecheck
pnpm --filter @ipeasy/web build    # 无类型错误，无 lint 错误

# 运行时验证（需 api dev 在线）
pnpm --filter @ipeasy/web dev
# 1. 访问 /admin/login → 看到登录表单
# 2. 错误密码 → 看到错误提示
# 3. 正确登录 → redirect /admin/users
# 4. 断开 api → 用户列表显示 error Alert（不是空表格）
# 5. confirm payment → Modal 有 reason 校验，成功后列表刷新
```

## 禁止

- 不在任何 `.catch` 里返回 `[]` 或空对象冒充无数据
- 不硬编码任何中文文案（走 i18n）
- 不在 Feature 组件里直接写 fetch（必须走 TanStack Query + api/client.ts）
- Admin 路由不绕过 beforeLoad guard
- 确认支付 Modal 的 reason 字段不能为空提交

## 2026-06-08 实现记录

### 已完成

- 补齐后端 Admin 最小页面所需真实接口：
  - `GET /api/users`：支持 `PLATFORM_ADMIN` 跨租户、`TENANT_ADMIN` 本租户、`USER` 拒绝访问。
  - `GET /api/audit`：支持 `action`、`actorType`、`from/to` 过滤，并按租户权限收敛。
  - `GET /api/sites/current`：登录前可从真实 active site 解析 `site.id`，避免前端硬编码站点。
- 前端 `api/client.ts` 对齐业务 envelope：
  - 自动附加 `Authorization: Bearer <admin_token/user_token>`。
  - `code !== 0` 时抛出 `ApiError(code, reasonKey, details)`。
  - 网络异常和非 JSON 响应统一为 `network_error`，不伪装成空数据。
- Admin login 改为先读取 `/api/sites/current`，再用真实 `siteId` 登录。
- 列表页权限错误识别改为使用稳定业务错误码 `PERMISSION_DENIED`。
- Admin/Customer 钱包流水增加真实 `LedgerEntryType` 过滤选项；后端支持 `from/to` 日期范围。
- 支付单状态筛选改为数据库真实 `PaymentOrderStatus`：`PENDING / CONFIRMING / COMPLETED / FAILED / REFUNDED`。
- 审计 actorType 筛选改为数据库真实 `AuditActorType`：`USER / ADMIN_USER / SYSTEM / APIKEY`。
- 确认支付后端接收并校验 `reason`，成功确认时写入 `audit_logs.reason`。
- 新增前端 API client 单测、Admin login 单测补充、Admin 最小页面后端集成测试。
- 已将跨层契约写入 `.trellis/spec/api-contract.md` 的 `Scenario: Admin minimum surface APIs`。

### 验证结果

- `pnpm --filter @ipeasy/api typecheck`：通过。
- `pnpm --filter @ipeasy/web typecheck`：通过。
- `rtk pnpm --filter @ipeasy/api lint`：通过。
- `rtk pnpm --filter @ipeasy/web lint`：通过。
- `rtk pnpm --filter @ipeasy/web test`：通过，3 files / 8 tests。
- `rtk pnpm --filter @ipeasy/api test`：通过，3 files / 18 tests。
- `rtk pnpm --filter @ipeasy/web build`：通过，仅 Vite chunk size warning。
- `rtk pnpm --filter @ipeasy/api build`：通过。
- `DATABASE_URL_TEST=... REDIS_URL=... rtk pnpm --filter @ipeasy/api test:integration`：通过，8 files / 37 passed / 2 skipped。
- `PAYMENT_CONFIRMATION_ENABLED=true DATABASE_URL_TEST=... REDIS_URL=... rtk pnpm --filter @ipeasy/api test:integration src/modules/payments/tests/payments-integration.spec.ts`：通过，11 passed / 1 skipped。
