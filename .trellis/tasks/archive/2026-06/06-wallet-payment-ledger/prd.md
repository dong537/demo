# Task 06 — Wallet / Payment / Ledger 单币种链路

## 目标

实现完整的单币种资金链路：充值单创建 → 人工确认 → 钱包余额更新 → 账本记录 → 审计。  
所有资金变化必须事务化；禁止 silent failure；禁止从前端或充值单推断余额。

## 实现要求

### domain.ts（wallet）

```ts
// 领域不变量
function assertSameCurrency(a: string, b: string): void  // 不同时 throw CURRENCY_NOT_SUPPORTED
function assertSufficientBalance(available: string, amount: string): void  // 不足时 throw WALLET_INSUFFICIENT_BALANCE
function assertPositiveAmount(amount: string): void  // <= 0 时 throw VALIDATION_ERROR
```

### wallet.repository.ts

```ts
getWalletByUserId(userId: string, tenantId: string): Promise<Wallet>
// not found → throw AppError(NOT_FOUND, 'wallet_not_found', 404)，不返回 null

listLedgerEntries(
  walletId: string,
  tenantId: string,
  query: PageQueryDto & { type?: LedgerEntryType }
): Promise<PageResult<LedgerEntry>>

// 事务方法（用 prisma.$transaction）
creditWalletTx(
  tx: PrismaTransactionClient,
  walletId: string,
  amount: string,
  currency: string,
  type: LedgerEntryType,
  relatedId: string,
  reason: string,
  idempotencyKey: string,
): Promise<LedgerEntry>

debitWalletTx(
  tx: PrismaTransactionClient,
  walletId: string,
  amount: string,
  currency: string,
  type: LedgerEntryType,
  relatedId: string,
  reason: string,
  idempotencyKey: string,
): Promise<LedgerEntry>
// 内部调用 assertSufficientBalance 再扣款
// 用 version 乐观锁：WHERE id=? AND version=? UPDATE version+1，行不存在 → throw INTERNAL_ERROR
```

### use-cases/get-wallet.use-case.ts

- `@RequireUser()` — 只能读自己的钱包
- `@RequireTenantAdmin()` — 可读本 tenant 任意用户钱包
- `@RequirePlatformAdmin()` — 可读跨 tenant（写 audit log）
- 返回 `{ available, frozen, currency, updatedAt }`

### use-cases/list-ledger.use-case.ts

- 权限同 `get-wallet`
- 支持分页和 `type` 过滤
- 返回 `PageResult<LedgerEntryDto>`

### use-cases/adjust-wallet.use-case.ts（Admin 调账）

- 只允许 `@RequirePlatformAdmin()` 或 `@RequireTenantAdmin()`（TENANT_ADMIN 只能调本 tenant）
- 必须接收 `reason` 和 `idempotencyKey`
- 事务内：creditWalletTx 或 debitWalletTx
- 写 audit log `wallet.adjust`，记录 actorId、targetUserId、amount、reason、requestId

### domain.ts（payments）

```ts
// 充值单状态机
type PaymentOrderStatus = 'PENDING' | 'CONFIRMING' | 'COMPLETED' | 'FAILED' | 'REFUNDED'
// 合法转换：PENDING→CONFIRMING→COMPLETED, PENDING→FAILED, CONFIRMING→FAILED, COMPLETED→REFUNDED
function assertCanConfirm(status: PaymentOrderStatus): void
function assertCanFail(status: PaymentOrderStatus): void
```

### use-cases/create-payment-order.use-case.ts

1. `@RequireUser()` 或 APIKey（USER scope）
2. 校验 currency === `platformCurrency`（assertSameCurrency）
3. 校验 amount > 0
4. 幂等：同 idempotencyKey 已存在 PENDING 单 → 返回已有单（不重复创建）
5. 只创建 `payment_orders(status=PENDING)`，**不改 wallets**
6. 写 audit log `payment_order.create`
7. 返回 `{ id, amount, currency, channel, status, createdAt }`

### use-cases/confirm-payment-order.use-case.ts

1. `@RequirePlatformAdmin()` 或 `@RequireTenantAdmin()`（视 channel 和权限配置）
2. 检查 `PAYMENT_CONFIRMATION_ENABLED === true`（否则 throw `UPSTREAM_DISABLED, 'payment_confirmation_disabled'`）
3. assertCanConfirm(order.status)
4. 检查幂等：同一 paymentOrderId 已有 COMPLETED 的 ledger_entry → 直接返回（不重复入账）
5. 事务内（`prisma.$transaction`）：
   a. `payment_orders.status = COMPLETING`
   b. `creditWalletTx(...)` type=DEPOSIT
   c. `payment_orders.status = COMPLETED, confirmedBy, confirmedAt`
6. 写 audit log `payment_order.confirm`
7. 返回更新后的 order + wallet 快照

### payments.repository.ts

```ts
createPaymentOrder(data): Promise<PaymentOrder>
getPaymentOrderById(id: string, tenantId: string): Promise<PaymentOrder>
// not found → throw NOT_FOUND，不返回 null
getPaymentOrderByIdempotencyKey(key: string, tenantId: string): Promise<PaymentOrder | null>
updatePaymentOrderStatus(tx, id: string, status, extra?): Promise<PaymentOrder>
listPaymentOrders(tenantId: string, query: PageQueryDto & { userId?, status?, channel? }): Promise<PageResult<PaymentOrder>>
```

### wallet.controller.ts

```
GET  /api/wallet/:userId          → get-wallet
GET  /api/wallet/:userId/ledger   → list-ledger (分页)
POST /api/wallet/:userId/adjust   → adjust-wallet (Admin only)
```

### payments.controller.ts

```
POST /api/payments                → create-payment-order
GET  /api/payments                → list（Admin: all; User: own）
GET  /api/payments/:id            → detail
POST /api/payments/:id/confirm    → confirm（Admin only）
```

## 必须测试

```ts
it('创建充值单不改 wallets.available')
it('同 idempotencyKey 重复创建返回已有单')
it('confirm 后 wallet.available 增加，ledger_entry 写入，payment_order=COMPLETED')
it('confirm 幂等：同 paymentOrderId 二次 confirm 不重复入账')
it('PAYMENT_CONFIRMATION_ENABLED=false 时 confirm 返回 UPSTREAM_DISABLED')
it('adjust 非平台币种 throw CURRENCY_NOT_SUPPORTED')
it('debit 超出余额 throw WALLET_INSUFFICIENT_BALANCE')
it('DB 故障不返回空流水（throw INTERNAL_ERROR）')
it('USER 不能调用 /adjust（PERMISSION_DENIED）')
it('TENANT_ADMIN 不能 adjust 其他 tenant 用户')
```

## 验证步骤

```bash
pnpm --filter @ipeasy/api typecheck
pnpm --filter @ipeasy/api test
pnpm --filter @ipeasy/api test:integration  # 需真实测试 DB
```

## 禁止

- 不用 JS number 计算金额（必须 Decimal.js）
- 不在 catch 块返回空流水或默认余额
- ledger_entries 不实现 delete 方法
- 不绕过事务直接更新 wallets

## 实现记录（2026-06-08）

- 明确钱包访问边界：新增 `wallet/access.ts`，统一解析 USER / TENANT_ADMIN / PLATFORM_ADMIN 对目标用户钱包的访问；平台管理员跨租户读写不再用空字符串 tenant 伪装无范围。
- 修正钱包/流水查询：目标钱包不存在时返回 `NOT_FOUND / wallet_not_found`，不返回空流水；平台管理员读钱包审计写入目标钱包所属 tenant。
- 修正调账：`reason` 和 `idempotencyKey` 必填；TENANT_ADMIN 只能调目标钱包所属本 tenant；PLATFORM_ADMIN 可跨 tenant 并按目标 tenant 审计；重复同 idempotencyKey 调账不重复入账。
- 修正 ledger 事务方法：写入前校验钱包币种；同 idempotencyKey 且语义一致返回已有流水，不改余额；语义冲突返回 `IDEMPOTENCY_CONFLICT / ledger_idempotency_conflict`。
- 修正充值单幂等：同一 `tenantId + userId + idempotencyKey` 返回已有单；其他用户/租户复用同 key 返回 `IDEMPOTENCY_CONFLICT / payment_order_idempotency_conflict`。
- 修正支付确认幂等：已有 `DEPOSIT` ledger 时先返回当前 order + wallet 快照，不再因 `COMPLETED` 状态误报无法 confirm。
- 补齐真实集成测试：充值单不改钱包、重复创建、跨用户 idempotency 冲突、确认关闭、确认成功、二次确认、USER 禁止调账、币种错误、超额扣款、TENANT_ADMIN 跨租户、PLATFORM_ADMIN 跨租户调账审计、缺失钱包流水不返回空列表。
- 更新 `.trellis/spec/database.md` 的资金幂等和租户边界可执行契约。

已运行验证：

```bash
pnpm --filter @ipeasy/api typecheck
pnpm --filter @ipeasy/api lint
pnpm --filter @ipeasy/api test
pnpm --filter @ipeasy/api test:integration
$env:PAYMENT_CONFIRMATION_ENABLED='true'; pnpm --filter @ipeasy/api test:integration src/modules/payments/tests/payments-integration.spec.ts
```
