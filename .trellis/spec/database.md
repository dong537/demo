# 数据库与迁移规范

## 数据库

本项目使用 PostgreSQL + Prisma。所有 schema 变更必须通过 Prisma migration 进入仓库。

## 第一阶段核心表

第一阶段至少覆盖：

- `sites`
- `tenants`
- `users`
- `admin_users`
- `sessions`
- `api_keys`
- `wallets`
- `ledger_entries`
- `payment_orders`
- `audit_logs`
- `system_settings`

第二阶段再加入：

- `provider_accounts`
- `platform_resources`
- `inventory_snapshots`
- `resource_mappings`
- `price_templates`
- `price_rules`
- `price_overrides`
- `orders`
- `order_items`
- `fulfillment_jobs`
- `upstream_order_mirrors`
- `proxy_instances`
- `upstream_request_logs`

## 租户边界

共享分站内所有业务对象必须带租户边界：

- 客户归属 tenant。
- APIKey 归属 tenant 和 owner。
- 钱包、账本、订单、代理镜像、审计按 tenant 隔离。
- tenant admin 查询默认带 tenant 过滤。
- platform admin 跨 tenant 写操作必须审计。

租户品牌配置：
- `tenants.brandConfig` 是 reseller/tenant 品牌配置的 source of truth。
- 未配置 `brandConfig` 时，公开品牌读取只能使用真实 `tenants.name` 作为 `siteName`，不得补假 Logo、主题色、域名或客服邮箱。
- `sites.brandConfig` 继续表示 site/platform 级品牌，不得与 `tenants.brandConfig` 混写成同一个领域对象。

## 资金一致性

- `wallets` 是余额 Source of Truth。
- `ledger_entries` 是审计账本，不允许静默删除。
- 创建充值单只写 `payment_orders`，不改钱包。
- 支付确认必须事务内写 `wallets + ledger_entries + payment_orders + audit_logs`。
- 调账必须有 `reason + idempotencyKey`。
- 金额字段用 decimal string 对应数据库 decimal，不用浮点数。
- 入账账本金额必须为正数，出账账本金额必须为负数；`debitWalletTx` 的入参金额仍使用正数做余额不足校验和余额扣减，但落库到 `ledger_entries.amount` 时必须写成负数。
- 钱包/流水访问不能用空字符串表示“无 tenant 限制”。`USER` 和 `TENANT_ADMIN` 必须解析目标钱包后按钱包 `tenantId` 校验；`PLATFORM_ADMIN` 可以在当前 `ctx.siteId` 内跨 tenant，但所有钱包、支付单、订单和租户查询仍必须带 `siteId`，写审计时必须使用目标钱包/订单所属 `tenantId`。
- `ledger_entries.idempotencyKey` 是资金变动幂等 source of truth：同 key 同 wallet/type/relatedId/currency/amount 返回已有流水，不再改余额；同 key 但语义不同必须返回 `IDEMPOTENCY_CONFLICT / ledger_idempotency_conflict`。
- `payment_orders.idempotencyKey` 虽然是 DB 全局唯一，但业务幂等只能对同一 `tenantId + userId + idempotencyKey` 返回已有单；其他用户或租户复用同 key 必须返回 `IDEMPOTENCY_CONFLICT / payment_order_idempotency_conflict`。
- 支付确认二次调用必须先查 `DEPOSIT` ledger 幂等记录，再跑状态机。`COMPLETED` 订单已有入账流水时应返回当前 order + wallet 快照，不重复入账，也不因 `assertCanConfirm(COMPLETED)` 误报失败。

## Scenario: Wallet / Payment Idempotency And Tenant Scope

### 1. Scope / Trigger
- Trigger: `POST /api/payments`、`POST /api/payments/:id/confirm`、`POST /api/wallet/:userId/adjust`、钱包/流水查询。

### 2. Signatures
- `getWalletByUserId(userId, siteId, tenantId?: string | null): Promise<Wallet>`
- `creditWalletTx(tx, walletId, amount, currency, type, relatedId, reason, idempotencyKey): Promise<LedgerEntry>`
- `debitWalletTx(tx, walletId, amount, currency, type, relatedId, reason, idempotencyKey): Promise<LedgerEntry>`
- `getPaymentOrderById(id, siteId, tenantId: string | null): Promise<PaymentOrder>`
- `getPaymentOrderByIdempotencyKey(key, tenantId, userId): Promise<PaymentOrder | null>`

### 3. Contracts
- `siteId` is always required for wallet/payment lookups. `tenantId = null` only means "all tenants inside this site" for trusted platform-admin/system workflows after explicit permission checks.
- Tenant-bound flows must pass or validate the target wallet/order tenant before returning data or writing audit.
- `creditWalletTx` writes positive ledger amount; `debitWalletTx` writes negative ledger amount.
- Duplicate ledger idempotency key with identical semantic fields returns the existing ledger and does not update `wallets.available`.

### 4. Validation & Error Matrix
- USER reading another wallet/ledger -> 403 `PERMISSION_DENIED`.
- TENANT_ADMIN targeting another tenant wallet -> 403 `TENANT_SCOPE_VIOLATION`.
- Missing wallet/ledger owner -> 404 `NOT_FOUND / wallet_not_found` (not empty list).
- Ledger idempotency key semantic mismatch -> 409 `IDEMPOTENCY_CONFLICT / ledger_idempotency_conflict`.
- Payment idempotency key reused by another user/tenant -> 409 `IDEMPOTENCY_CONFLICT / payment_order_idempotency_conflict`.
- Confirm disabled -> 503 `UPSTREAM_DISABLED / payment_confirmation_disabled`.

### 5. Good/Base/Bad Cases
- Good: platform admin adjusts another tenant user's wallet; audit log stores the target wallet tenant.
- Base: duplicate confirm returns the completed order and wallet snapshot with one `DEPOSIT` ledger.
- Bad: platform admin reads a wallet or payment order by global id without `siteId`, leaking another reseller site.
- Bad: `ctx.tenantId ?? ""` passed to repository for platform admin, causing cross-tenant reads to look like not found.

### 6. Tests Required
- Integration tests for create-payment no wallet mutation, duplicate same-user idempotency, cross-user idempotency conflict.
- Integration tests for confirm disabled, confirm success, duplicate confirm without duplicate ledger.
- Integration tests for adjust currency mismatch, overdraft, tenant-admin cross-tenant denial, platform-admin cross-tenant audit, missing wallet ledger not empty.
- Integration tests for platform-admin cross-site denial on payment list/detail/confirm and wallet adjust.

### 7. Wrong vs Correct

#### Wrong
```ts
const wallet = await walletRepo.getWalletByUserId(userId, ctx.tenantId ?? '');
```

This turns `PLATFORM_ADMIN` cross-tenant access into an empty-tenant lookup and may hide authorization bugs as not found.

```ts
const order = await paymentsRepo.getPaymentOrderById(orderId, null);
```

This treats payment ids as globally readable for platform admins and can cross site boundaries.

#### Correct
```ts
const wallet = await getWalletForContext(walletRepo, ctx, userId);
assertTenantAccess(ctx, wallet.tenantId);
```

Resolve the target resource first, then enforce tenant scope from the resource's source-of-truth tenant.

```ts
const order = await paymentsRepo.getPaymentOrderById(orderId, ctx.siteId, tenantScope);
```

Platform-admin cross-tenant reads are still scoped to the authenticated site.

## Scenario: Debit Ledger Sign

### 1. Scope / Trigger
- Trigger: 所有调用 `debitWalletTx` 的扣款、续费、购买和人工扣款流程。

### 2. Signatures
- `debitWalletTx(tx, walletId, amount, currency, type, relatedId, reason, idempotencyKey)`
- `amount` 参数：正数字符串，例如 `"48"`。
- `ledger_entries.amount`：负数字符串，例如 `"-48"`。

### 3. Contracts
- `wallets.available` 用 `available - amount` 计算。
- `ledger_entries.balanceAfter` 写扣减后的余额。
- `ledger_entries.amount` 的符号表达资金方向：正数入账，负数出账。

### 4. Validation & Error Matrix
- `available < amount` -> `WALLET_INSUFFICIENT_BALANCE`。
- `amount <= 0` -> 调用方必须先返回 `VALIDATION_ERROR`。
- 乐观锁更新 0 行 -> `INTERNAL_ERROR / optimistic_lock_failed`。

### 5. Good/Base/Bad Cases
- Good: 余额 `100`，扣款参数 `"48"`，余额变 `52`，账本 `amount="-48"`。
- Base: 入账 `creditWalletTx("100")` 写 `amount="100"`。
- Bad: 扣款后余额正确，但账本写 `amount="48"`，会把消费误报成入账。

### 6. Tests Required
- 集成测试必须断言购买成功后 `wallets.available` 减少，并且 `ledger_entries(type=DEBIT).amount` 为负数。
- 余额不足测试必须断言钱包余额不变且无订单创建。

### 7. Wrong vs Correct

#### Wrong
```ts
amount,
balanceAfter: newAvailable,
```

#### Correct
```ts
amount: toDecimalString(`-${amount}`),
balanceAfter: newAvailable,
```

## 迁移规则

- 本地开发用 `prisma migrate dev`。
- 部署前只允许 `migrate:deploy`。
- 禁止在生产、灰度、预发使用 `prisma db push`。
- 禁止生产运行 seed、测试数据脚本、临时修补 SQL。
- 已应用生产的 migration 不允许修改；错误只能通过新的 corrective migration 修复。
- migration 失败必须让部署失败，不能跳过。

## 禁止事项

- 不用内存 DB 伪造集成测试。
- 不手写临时 SQL 绕开 repository/use case。
- 不用默认值掩盖未知配置。
- 不把 DB 故障返回成空列表或业务未配置。
