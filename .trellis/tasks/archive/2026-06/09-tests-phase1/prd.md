# Task 09 — 第一阶段测试覆盖

## 目标

按 EXECUTION_PLAN.md 铁律：**没有失败测试，不写生产代码**。本任务确保第一阶段所有关键行为有测试证据，覆盖权限、资金、错误传播。禁止 memory mock DB，禁止放宽断言。

## 实现要求

### 1. Domain 单元测试（无 I/O 依赖）

**apps/api/src/common/money/tests/money.spec.ts**
```ts
it('toDecimalString 正常转换')
it('addMoney 精度正确（避免 0.1+0.2 浮点误差）')
it('subtractMoney 精度正确')
it('isPositive(0) → false')
it('assertCurrency CNY vs USD → throw CURRENCY_NOT_SUPPORTED')
```

**apps/api/src/modules/wallet/tests/wallet-domain.spec.ts**
```ts
it('assertSufficientBalance: available < amount → throw WALLET_INSUFFICIENT_BALANCE')
it('assertSufficientBalance: available === amount → 通过')
it('assertPositiveAmount(0) → throw VALIDATION_ERROR')
it('assertPositiveAmount(-1) → throw VALIDATION_ERROR')
it('assertSameCurrency(CNY, USD) → throw CURRENCY_NOT_SUPPORTED')
```

### 2. Auth + RBAC 集成测试（真实测试 DB）

**apps/api/src/modules/auth/tests/auth-integration.spec.ts**

使用 Supertest，启动完整 NestJS app，连真实 PostgreSQL 测试库（DATABASE_URL 指向测试 DB，beforeAll migrate, afterAll clean）：

```ts
describe('权限边界')
it('USER + 请求 /api/system/xxx → 403 PERMISSION_DENIED')
it('USER scope 包含 system:* → 403（guard 拒绝）')
it('TENANT_ADMIN A 请求 tenant B 的钱包 → 403 TENANT_SCOPE_VIOLATION')
it('PLATFORM_ADMIN 请求 tenant B 的钱包 → 200 且写 audit_log')
it('过期 session → 401 AUTH_REQUIRED')
it('已撤销 session → 401 AUTH_REQUIRED')
it('错误密码 → 401 AUTH_REQUIRED，不泄露是邮箱不存在还是密码错误')
it('apikey IP whitelist 不匹配 → 403 PERMISSION_DENIED')
```

### 3. Wallet + Payment 集成测试（真实测试 DB）

**apps/api/src/modules/wallet/tests/wallet-integration.spec.ts**

```ts
it('GET /api/wallet/:userId 返回真实余额，不是默认值')
it('DB 故障（关闭连接）→ 返回 500 INTERNAL_ERROR，不是空 wallet')
it('USER 请求他人钱包 → 403')
it('ledger 列表 DB 故障 → 500，不是空数组')
```

**apps/api/src/modules/payments/tests/payments-integration.spec.ts**

```ts
it('创建充值单：wallets.available 不变，payment_orders 新建 PENDING')
it('创建充值单 idempotency：同 key 两次 → 返回同一单，不重复创建')
it('确认充值：wallet.available 增加，ledger_entry 写入，payment_order=COMPLETED')
it('确认充值幂等：同 paymentOrderId 确认两次 → 第二次返回已完成，不重复入账')
it('PAYMENT_CONFIRMATION_ENABLED=false → 确认返回 UPSTREAM_DISABLED')
it('adjust 调账 CNY ≠ platformCurrency → CURRENCY_NOT_SUPPORTED')
it('adjust 调账超出余额 → WALLET_INSUFFICIENT_BALANCE，钱包余额不变，无 ledger_entry')
it('USER 调用 /adjust → 403 PERMISSION_DENIED')
it('TENANT_ADMIN 调用其他 tenant 用户 /adjust → 403')
it('platform admin adjust 后写 audit_log，包含 actorId + reason + requestId')
```

### 4. 前端路由守卫测试

**apps/web/src/features/auth/tests/admin-login.spec.tsx**（Vitest + Testing Library）

```tsx
it('未登录访问 /admin/users → redirect /admin/login')
it('登录表单：email 无效 → 显示校验错误，不提交')
it('登录表单：password 空 → 显示校验错误，不提交')
it('API 返回 AUTH_REQUIRED → 显示"邮箱或密码错误"，不崩溃')
it('API 网络错误 → 显示通用错误，不崩溃')
```

**apps/web/src/features/wallet/tests/customer-wallet.spec.tsx**

```tsx
it('API 返回 PERMISSION_DENIED → 显示 permission denied Alert，不是空余额')
it('API 500 错误 → 显示 error Alert，不是 0 余额')
it('创建充值单 amount=0 → 表单校验阻止提交')
it('创建充值单 amount 负数 → 表单校验阻止提交')
```

### 5. E2E smoke（Playwright）

**e2e/admin-login.spec.ts**
```ts
test('Admin 可以登录后看到用户列表（有数据或 empty 状态，无报错）')
test('未登录直接访问 /admin/users → redirect 到 /admin/login')
```

**e2e/customer-topup.spec.ts**
```ts
test('Customer 登录 → 余额页显示真实 wallet（非 0 占位）')
test('Customer 创建充值单 → 看到 PENDING 状态和单号')
```

### 6. 测试基础设施

**vitest.config.ts**（根目录）
- 覆盖率报告 c8，threshold: statements 80%、branches 70%
- 排除 `generated/`、`dist/`、`.trellis/`

**playwright.config.ts**（根目录）
- baseURL: `http://localhost:4173`（vite preview）
- projects: chromium
- testDir: `e2e/`

**测试 DB 配置**
- 测试用例使用独立 `DATABASE_URL_TEST` 环境变量
- beforeAll：`prisma migrate deploy`（测试库）
- afterAll：truncate 所有表（保留 schema）
- 每个 describe block beforeEach 清理相关表

## 验证步骤

```bash
pnpm typecheck
pnpm lint
pnpm test             # 所有单元 + 集成测试通过
pnpm --filter @ipeasy/web test   # 前端路由守卫测试通过
pnpm build
pnpm e2e              # Playwright smoke 通过
```

最终必须提供 `pnpm test` 输出截图或日志，所有测试 PASS，无 skip，无 pending。

## 禁止

- 不用 memory mock DB（必须真实 PostgreSQL 测试库）
- 不用 `vi.mock` 模拟 repository 来测试 use case 是否调用了正确方法（测行为不测实现）
- 不放宽断言通过测试（例如 `.toBeGreaterThanOrEqual(0)` 代替具体余额验证）
- 不使用大 snapshot 锁死 UI 输出

## 实现记录（2026-06-08）

### 已完成

- 后端补齐真实行为覆盖：Auth/RBAC 增加未知邮箱同形错误、API key IP 白名单；Wallet 增加真实余额、他人钱包拒绝、ledger 分页、DB outage 500；Payment 确认路径不再 skip，通过测试配置同时覆盖启用/禁用确认。
- 修复测试暴露的生产问题：分页 query 在 repository 边界统一转 number；Customer 充值金额不再用 AntD `min` 静默纠正非法值；TanStack Router 的 `/admin` layout 不再同时定义 `id` 和 `path`。
- 前端单测补齐：Admin 登录 password 为空与网络错误；Customer 充值 amount=0/负数阻止提交。
- E2E 基础设施补齐：根级 Turbo `e2e` task、Playwright config、真实 DB seed、E2E API/Web 启动脚本，浏览器 smoke 使用生产构建产物与真实 API/DB。
- 规范沉淀：已更新 `.trellis/spec/testing-deployment.md`、`.trellis/spec/api-contract.md`、`.trellis/spec/backend/database-guidelines.md`、`.trellis/spec/frontend/quality-guidelines.md`。

### 验证结果

- `pnpm --filter @ipeasy/api typecheck` PASS。
- `pnpm --filter @ipeasy/web typecheck` PASS。
- `pnpm --filter @ipeasy/api lint` PASS。
- `pnpm --filter @ipeasy/web lint` PASS。
- `pnpm --filter @ipeasy/api test` PASS：3 files / 18 tests。
- `pnpm --filter @ipeasy/web test` PASS：4 files / 15 tests。
- `pnpm --filter @ipeasy/api test:integration` PASS：9 files / 47 tests，真实 PostgreSQL。
- `pnpm --filter @ipeasy/api build` PASS。
- `pnpm --filter @ipeasy/web build` PASS，仅 Vite chunk size warning。
- `pnpm e2e` PASS：4 Playwright smoke，真实 PostgreSQL + 生产构建产物。
- `rg "\b(it|test|describe)\.skip\b|\bskip\(" apps e2e -n` 无命中。
- `git diff --check` PASS，仅 Windows CRLF 提示。
