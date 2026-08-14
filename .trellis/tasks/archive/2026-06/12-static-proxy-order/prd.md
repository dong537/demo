# Task 12 — 静态代理下单 / 履约闭环

## 目标

实现完整的静态住宅代理购买链路：报价确认 → 事务内扣余额+建订单+建履约任务 → worker 异步调用 Provider Adapter → 写 proxy_instances → 交付用户。包含续费/改密/切 IP 生命周期操作。

## Prisma schema 新增表

**orders**
- `id` UUID PK
- `siteId` String, `tenantId` String, `userId` String -> users.id
- `type` Enum: `STATIC_PROXY_BUY | STATIC_PROXY_RENEW`
- `status` Enum: `PENDING | FULFILLING | COMPLETED | PARTIALLY_COMPLETED | FAILED | REFUNDED`
- `resourceId` String -> platform_resources.id
- `quantity` Int
- `durationDays` Int
- `unitPrice` Decimal(20,8), `totalPrice` Decimal(20,8), `currency` String
- `quoteSnapshot` Json（报价时的 QuoteResult 镜像）
- `paymentOrderId` String nullable（关联充值单或余额扣款记录）
- `idempotencyKey` String unique
- `failReason` String nullable
- `createdAt` DateTime, `updatedAt` DateTime

**fulfillment_jobs**
- `id` UUID PK
- `siteId` String, `orderId` String -> orders.id
- `providerCode` String
- `status` Enum: `QUEUED | RUNNING | COMPLETED | FAILED | RETRYING`
- `attempts` Int default 0
- `maxAttempts` Int default 3
- `lastError` String nullable
- `scheduledAt` DateTime default now
- `startedAt` DateTime nullable, `completedAt` DateTime nullable
- `createdAt` DateTime, `updatedAt` DateTime

**upstream_order_mirrors**
- `id` UUID PK
- `siteId` String, `orderId` String -> orders.id
- `fulfillmentJobId` String -> fulfillment_jobs.id
- `providerCode` String
- `upstreamOrderId` String
- `status` String
- `rawResponse` Json nullable（脱敏）
- `createdAt` DateTime, `updatedAt` DateTime

**proxy_instances**
- `id` UUID PK
- `siteId` String, `tenantId` String, `userId` String -> users.id
- `orderId` String -> orders.id
- `upstreamOrderMirrorId` String -> upstream_order_mirrors.id
- `providerCode` String
- `ip` String, `port` Int
- `username` String, `password` String（加密存储）
- `protocol` Enum: `HTTP | SOCKS5`
- `countryCode` String, `regionCode` String nullable
- `ipType` Enum: `NATIVE | BROADCAST`
- `status` Enum: `DELIVERING | ACTIVE | EXPIRING | EXPIRED | RELEASING | RELEASED | FAILED`
- `expiresAt` DateTime
- `businessType` String nullable
- `userNote` String nullable
- `createdAt` DateTime, `updatedAt` DateTime

## create-static-proxy-order.use-case.ts

1. `@RequireUser()` 或 APIKey（USER scope）
2. 调用 `quote.use-case`，校验 QuoteResult.isSaleable
3. 校验余额：`assertSufficientBalance(wallet.available, totalPrice)`
4. 校验幂等：同 idempotencyKey 已有 PENDING/FULFILLING/COMPLETED 订单 → 返回已有单
5. 事务内：
   a. `debitWalletTx(...)` type=DEBIT，reason='static_proxy_order'
   b. 创建 `orders(status=PENDING)`，保存 quoteSnapshot
   c. 创建 `fulfillment_jobs(status=QUEUED)`
6. 写 audit log `order.create`
7. 返回订单 ID 和状态

## fulfill-static-proxy.use-case.ts（worker 调用）

1. 取 `fulfillment_jobs(status=QUEUED)` 任务
2. 更新 status=RUNNING，startedAt=now
3. 从 order.quoteSnapshot 取 providerCode，调 `ProviderRegistry.getAdapter(code).buyStaticProxy(...)`
4. 成功：
   a. 创建 `upstream_order_mirrors`
   b. 创建 `proxy_instances`（ip/port/username/password 加密存储）
   c. `orders.status = COMPLETED`
   d. `fulfillment_jobs.status = COMPLETED`
5. 失败：
   a. `fulfillment_jobs.attempts++`，若 < maxAttempts 设 status=RETRYING
   b. 若 attempts >= maxAttempts：`orders.status = FAILED`，触发退款（`creditWalletTx` type=REFUND）
   c. 写 audit log，不生成假代理
6. 每次尝试写 `upstream_request_logs`

## proxies.controller.ts — Customer + Admin API

```
GET  /api/proxies                      → 我的代理列表（RequireUser，分页+filter）
GET  /api/proxies/:id                  → 代理详情 + 复制格式
POST /api/proxies/:id/renew            → 续费
POST /api/proxies/:id/change-password  → 改密
POST /api/proxies/:id/switch-ip        → 切 IP
GET  /api/proxies/export               → 导出（IP:PORT / IP:PORT:USER:PASS / HTTP URL / SOCKS5 URL）
```

## 导出格式

```ts
type ExportFormat = 'IP_PORT' | 'IP_PORT_AUTH' | 'AUTH_AT_IP_PORT' | 'HTTP_URL' | 'SOCKS5_URL';
// IP_PORT         → "1.2.3.4:8080"
// IP_PORT_AUTH    → "1.2.3.4:8080:user:pass"
// AUTH_AT_IP_PORT → "user:pass@1.2.3.4:8080"
// HTTP_URL        → "http://user:pass@1.2.3.4:8080"
// SOCKS5_URL      → "socks5://user:pass@1.2.3.4:8080"
```

## apps/worker/src/main.ts

简单 NestJS 应用，启动 `FulfillmentWorker`，每 30s 轮询 `fulfillment_jobs(status IN [QUEUED, RETRYING])`，调用 `fulfill-static-proxy.use-case`。

## 验证步骤

```bash
pnpm --filter @ipeasy/api typecheck
pnpm --filter @ipeasy/worker typecheck
# 集成测试：
# POST /api/orders/static-proxy → 余额不足 → WALLET_INSUFFICIENT_BALANCE
# POST /api/orders/static-proxy → Provider DISABLED → UPSTREAM_DISABLED
# POST /api/orders/static-proxy → 成功 → 写 orders + fulfillment_jobs，余额减少
# Worker 拉起 → fulfillment job COMPLETED → proxy_instances 写入
```

## 禁止

- 未真实履约时不生成 proxy_instances（orders.status=FAILED 不创建代理）
- 退款必须走 creditWalletTx + ledger + audit，不直接改 wallets
- proxy_instances 的 password 必须加密存储（AES-256-GCM）
