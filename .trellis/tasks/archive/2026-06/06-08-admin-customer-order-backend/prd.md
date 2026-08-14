# 管理端代客下单后端

## Goal

补齐 Admin 代客下单的后端能力，让平台管理员或代理商管理员可以从客户上下文发起静态代理购买，不需要手动输入数据库 ID，同时仍按目标客户身份报价、扣款、创建订单和履约任务，并写入可审计的 Admin 操作记录。

## Requirements

- 新增管理端静态代理代客下单接口：
  - `POST /api/orders/users/:userId/static-proxy`
  - body 复用用户静态代理购买字段：`resourceId`, `quantity`, `durationDays`, `currency`, `idempotencyKey`, `businessType?`, `reason`。
- 权限边界：
  - `PLATFORM_ADMIN` 可以为当前 site 内任一用户代客下单。
  - `TENANT_ADMIN` 只能为自己 `tenantId` 下用户代客下单。
  - `USER` 和其它 ownerType 禁止调用该管理端接口。
- Source of truth：
  - 目标用户的 `siteId`, `tenantId`, 钱包和价格上下文来自数据库中的真实用户记录。
  - 下单报价必须使用目标用户的 `userId` 与 `tenantId`。
  - 扣款必须扣目标用户钱包。
- 业务语义：
  - 代客下单创建的订单仍属于目标用户，订单类型、履约任务、钱包账本与普通用户下单一致。
  - `idempotencyKey` 仍在订单层保持幂等；重复成功请求返回同一订单，不重复扣款。
  - `idempotencyKey` 冲突但目标用户/租户不一致时必须返回 `IDEMPOTENCY_CONFLICT`。
  - `reason` 必填，写入审计日志。
- 审计：
  - `audit_logs.actorType = ADMIN_USER`
  - `actorId = ctx.ownerId`
  - `targetType = orders`
  - `targetId = order.id`
  - `action = order.admin_create`
  - `tenantId = targetUser.tenantId`
  - `reason` 为请求 body 的原因。
  - `meta` 至少包含 `targetUserId`, `idempotencyKey`, `totalPrice`, `currency`。
- OpenAPI/Contracts：
  - 为新接口导出 Swagger schema，并重新生成 contracts。
- 测试：
  - 增加真实 PostgreSQL 集成测试，覆盖平台管理员成功代客下单、租户管理员跨租户禁止、幂等不重复扣款、reason 必填、普通用户禁止调用。

## Acceptance Criteria

- [ ] `POST /api/orders/users/:userId/static-proxy` 可由 `PLATFORM_ADMIN` 为当前 site 用户创建静态代理订单。
- [ ] `TENANT_ADMIN` 代本租户用户下单成功，跨租户返回 403。
- [ ] `USER` 调用管理端代客下单接口返回 403。
- [ ] 成功后目标用户钱包扣款、账本写 DEBIT、订单归属目标用户、履约任务入队。
- [ ] 成功审计记录 actor 是 Admin，tenant/target 指向目标用户订单。
- [ ] 空 reason 返回 `VALIDATION_ERROR / reason_required`，不扣款、不建订单。
- [ ] 重复相同 `idempotencyKey` 不重复扣款。
- [ ] `pnpm --filter @ipeasy/api typecheck/lint/test/build`、相关 integration suite、OpenAPI export/contracts generate/typecheck 通过。

## Source of Truth

- 用户归属、租户边界和钱包来自 `users` / `wallets` 表。
- 报价来自 `QuoteUseCase` 和价格/库存真实数据。
- 订单与履约状态来自 `orders` / `fulfillment_jobs`。
- 前端未来只传路径上的用户 ID；当前任务不实现 UI。

## Module Boundaries

- `CreateStaticProxyOrderUseCase`：抽取可复用的购买执行路径，支持 USER 自助和 ADMIN 代客两种 actor。
- `OrdersController`：新增管理端路由并保持普通用户 `/api/orders/static-proxy` 不变。
- `OrdersRepository`：必要时新增按 site/user 读取用户上下文的查询，避免 controller 直接查 Prisma。
- DTO：`AdminCreateStaticProxyOrderDto` 表达管理端必填 reason。
- Tests：放在 `apps/api/src/modules/orders/tests/`，使用真实 DB。

## Interface Contracts

```http
POST /api/orders/users/:userId/static-proxy
Authorization: Bearer <admin session>
Content-Type: application/json

{
  "resourceId": "uuid",
  "quantity": 2,
  "durationDays": 30,
  "currency": "CNY",
  "idempotencyKey": "admin-buy-...",
  "businessType": "telegram",
  "reason": "customer requested assisted purchase"
}
```

Success:

```json
{ "orderId": "uuid", "status": "PENDING" }
```

Errors:

- `403 PERMISSION_DENIED / admin_only` for non-admin callers.
- `403 TENANT_SCOPE_VIOLATION / tenant_access_denied` for tenant-admin cross-tenant target.
- `400 VALIDATION_ERROR / reason_required` for blank reason.
- Existing quote/wallet/order errors propagate unchanged.

## Data Flow

Admin session -> controller validates admin route -> load target user in current site -> tenant access check -> quote as target user -> debit target wallet -> create target order -> create fulfillment job -> write admin audit -> return order result.

## Out of Scope

- 不实现前端代客下单页面/按钮。
- 不新增代客续费。
- 不改变普通用户下单接口和 OpenAPI 985 `/res_static/buy` 行为。
- 不新增支付渠道或手动充值逻辑。

## Technical Notes

- Existing customer purchase use case: `apps/api/src/modules/orders/use-cases/create-static-proxy-order.use-case.ts`.
- Existing admin order operation pattern: `apps/api/src/modules/orders/use-cases/admin-order-operations.use-case.ts`.
- Existing purchase integration tests: `apps/api/src/modules/orders/tests/purchase-flow-integration.spec.ts`.
- Tenant boundary helper: `apps/api/src/common/auth/tenant-guard.ts`.
- Wallet access helper shows target-user lookup pattern: `apps/api/src/modules/wallet/access.ts`.
