# Task 08 — Customer 最小页面

## 目标

实现 Customer surface 的最小可用页面集：登录、余额概览、创建充值单、钱包流水。所有数据来自真实 API；购买静态代理进入第二阶段，本任务不实现。

## 实现要求

### 路由结构

```
/login                   → Customer 登录（不需要 auth）
/                        → redirect → /overview
/overview                → 余额概览（RequireUser guard）
/wallet                  → 钱包流水（RequireUser guard）
/wallet/topup            → 创建充值单（RequireUser guard）
```

beforeLoad guard：检查 sessionStorage 中 user token，无效 → redirect `/login`。

### CustomerLogin（features/auth/customer-login.feature.tsx）

- Form：email + password，React Hook Form + Zod
- 提交 `POST /api/auth/login`，token 存 sessionStorage，redirect `/overview`
- 错误：credentials 错误显示具体提示；网络错误显示通用错误
- 页面风格：白底居中卡片，主色 `#0040ff`，无装饰 orb/渐变

### CustomerWalletOverview（features/wallet/customer-wallet-overview.feature.tsx）

- 调用 `GET /api/wallet/:userId`（userId 从 decoded session 取）
- 展示：可用余额、冻结余额、币种
- 状态：loading skeleton、error Alert（显示 reasonKey，不是空数据）、permission denied
- 操作按钮：「充值」→ navigate `/wallet/topup`

### CustomerLedgerList（features/wallet/customer-ledger-list.feature.tsx）

- 调用 `GET /api/wallet/:userId/ledger`
- Table：type、amount（正负标色）、balanceAfter、reason、createdAt
- 分页 + type filter + date range filter
- 状态：loading / empty（显示"暂无流水记录"）/ error / pagination

### CreatePaymentOrder（features/wallet/create-payment-order.feature.tsx）

- Form：
  - amount（数字输入，> 0，Zod 校验）
  - channel（Select：MANUAL / YIPAY / ALIPAY，第一阶段只启用 MANUAL）
  - 提交前展示"确认充值 ¥{amount}"摘要
- 提交调用 `POST /api/payments`
- 成功后：显示充值单号、金额、状态（PENDING），告知用户等待人工确认
- 失败显示 reasonKey 对应的 i18n 文案

### i18n 补充

在 `zh.ts` / `en.ts` 补充 Customer surface 所有文案：页面标题、按钮、空状态、错误、充值状态说明。

## 验证步骤

```bash
pnpm --filter @ipeasy/web typecheck
pnpm --filter @ipeasy/web build

# 运行时
# 1. /login 页面正常展示
# 2. 错误密码 → 错误提示
# 3. 登录成功 → /overview 显示真实余额
# 4. 断开 api → /overview 显示 error Alert，不是空卡片
# 5. 创建充值单 → amount=0 时表单校验阻止提交
# 6. 成功创建 → 显示单号和 PENDING 状态
```

## 禁止

- 不展示假余额、假充值记录
- catch 后不返回空数组或默认余额
- 购买入口暂不实现（不留假按钮，不留 TODO 占位）
- 不硬编码文案（走 i18n）

## 2026-06-08 实现记录

### 已完成

- 新增 `GET /api/auth/me`，让前端从真实 opaque session 获取 `ownerId/ownerType/siteId/tenantId/scopes`。
- Customer 登录改为先读取 `/api/sites/current`，再用真实 `siteId` 调用 `/api/auth/login`，不再硬编码 `siteId: "user"`。
- Customer 路由 guard 校验 `sessionStorage.user_token` 和 `/api/auth/me` 的 `ownerType === "USER"`；认证错误清 token 并跳 `/login`，网络错误交给页面 error Alert。
- 钱包概览和流水改为通过 `useCurrentCustomer()` 读取当前用户，再请求 `/api/wallet/:ownerId` 与 `/api/wallet/:ownerId/ledger`，不再把 opaque token 当 JWT 解码。
- 钱包流水空状态使用 `customer.ledger.empty` 文案。
- 创建充值单从真实钱包读取币种，并提交后端必需字段 `amount/currency/channel/idempotencyKey`；第一阶段只启用 MANUAL 渠道。
- 移除 Customer 第一阶段路由树中的 `/buy`、`/proxies`，购买/代理留到后续任务。
- Customer 登录表单对齐 Admin 登录，使用 React Hook Form `Controller` 包 Ant Design Input。
- 新增 Customer 登录单测、更新 Customer 钱包单测、补充 auth/me 后端集成测试。
- 已将跨层契约写入 `.trellis/spec/api-contract.md` 的 `Scenario: Customer minimum surface APIs`。

### 验证结果

- `pnpm --filter @ipeasy/api typecheck`：通过。
- `pnpm --filter @ipeasy/web typecheck`：通过。
- `rtk pnpm --filter @ipeasy/api lint`：通过。
- `rtk pnpm --filter @ipeasy/web lint`：通过。
- `rtk pnpm --filter @ipeasy/web test`：通过，4 files / 11 tests。
- `rtk pnpm --filter @ipeasy/api test`：通过，3 files / 18 tests。
- `rtk pnpm --filter @ipeasy/web build`：通过，仅 Vite chunk size warning。
- `rtk pnpm --filter @ipeasy/api build`：通过。
- `DATABASE_URL_TEST=... REDIS_URL=... rtk pnpm --filter @ipeasy/api test:integration`：通过，8 files / 38 passed / 2 skipped。
