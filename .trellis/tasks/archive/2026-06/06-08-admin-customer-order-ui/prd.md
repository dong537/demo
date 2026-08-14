# 管理端代客下单前端

## Goal

在 Admin 后台提供自然可用的代客下单入口，让平台管理员或租户管理员可以从客户列表/客户上下文为真实用户创建静态代理订单。前端只提交目标用户 id 和购买意图，报价、钱包扣款、订单、履约任务和审计仍由后端 `POST /api/orders/users/:userId/static-proxy` 作为 source of truth。

## Requirements

- 在 Admin 用户列表增加“代客下单”操作入口。
- 点击后打开抽屉或弹窗表单，目标用户信息从当前用户行带入，不要求后台人员手动输入数据库 ID。
- 表单字段：
  - `resourceId`
  - `quantity`
  - `durationDays`
  - `currency`
  - `businessType?`
  - `reason`
- `idempotencyKey` 前端每次提交生成，不让操作员手填。
- 成功后提示订单创建成功，并刷新/引导到订单列表可见该用户订单。
- 失败时展示后端 `reasonKey`，不能把权限/余额/库存/价格错误吞成空状态。
- 使用已生成 contracts/API client 路径，不手写另一套后端契约。
- 不实现付款/充值/价格手动覆盖；目标用户余额不足时按后端错误展示。

## Acceptance Criteria

- [ ] Admin 用户列表每行有代客下单入口。
- [ ] 表单提交真实调用 `POST /api/orders/users/:userId/static-proxy`。
- [ ] 成功后可以在订单列表按 `userId` 查看新订单。
- [ ] `reason` 必填；空 reason 不发请求或显示本地校验。
- [ ] `idempotencyKey` 自动生成，重复点击 pending 状态不会重复提交。
- [ ] 平台管理员和租户管理员沿用后端权限；USER 无 Admin UI 入口。
- [ ] i18n 文案不硬编码在组件里。
- [ ] 前端 unit test 覆盖 API client 方法、用户列表触发表单、成功/错误反馈。
- [ ] `pnpm --filter @ipeasy/web typecheck/lint/test/build` 通过。

## Source of Truth

- 目标用户来自 `/api/users` 的真实列表行 `id/email/tenantId/status`。
- 静态代理资源和可售状态来自后端资源/报价相关 API；前端不能伪造价格或库存。
- 下单结果、扣款、订单状态、履约任务和审计来自后端 `POST /api/orders/users/:userId/static-proxy`。
- 用户可见文案来自 Admin i18n 字典。

## Module Boundaries

- API client：新增 `createAdminStaticProxyOrder(userId, body)`，只封装路径和类型。
- Admin users page：提供入口和目标用户上下文。
- Admin order form/drawer：负责表单状态、本地必填校验、pending 状态、调用 mutation。
- Orders page：复用现有订单列表查询能力；成功后可跳转或提示按用户过滤。

## Interface Contract

```http
POST /api/orders/users/:userId/static-proxy
{
  "resourceId": "uuid",
  "quantity": 1,
  "durationDays": 30,
  "currency": "CNY",
  "idempotencyKey": "admin-ui-...",
  "businessType": "telegram",
  "reason": "customer requested assisted purchase"
}
```

Success:

```json
{ "orderId": "uuid", "status": "PENDING" }
```

Errors to surface:

- `PERMISSION_DENIED / admin_only`
- `TENANT_SCOPE_VIOLATION / tenant_access_denied`
- `VALIDATION_ERROR / reason_required`
- `IDEMPOTENCY_CONFLICT / order_idempotency_conflict`
- existing quote/wallet/resource errors.

## Data Flow

Admin users list row -> open assisted-order drawer with target user -> submit form -> API client calls backend -> mutation success invalidates orders/users as needed -> show success message with order id -> operator can inspect order list and audit logs.

## Out of Scope

- 不新增客户充值入口。
- 不新增手动改价。
- 不实现前端实时 quote 预览，除非现有 API/UI 已有低风险复用入口。
- 不新增 fake resource list；资源选择必须来自真实后端数据或现有资源列表 API。

## Verification Notes

- Frontend tests should mock API client at boundary, not backend DB.
- End-to-end smoke will use real backend API after implementation.
