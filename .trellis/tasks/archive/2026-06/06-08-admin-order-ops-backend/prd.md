# 管理端订单故障处置后端

## Goal

补齐 PRD 要求的管理端订单故障处置后端能力，让管理员可以对静态代理订单执行重试履约、退款、人工补单完成三类动作，并保证订单、钱包、履约任务和审计日志的数据一致性。

## What I Already Know

* 现有订单接口只有创建、列表、详情和履约详情读取：`apps/api/src/modules/orders/orders.controller.ts`。
* 现有履约失败在 worker 内部自动退款：`apps/api/src/modules/fulfillment/use-cases/fulfill-static-proxy.use-case.ts`。
* 钱包写账必须通过 `WalletRepository.creditWalletTx/debitWalletTx`，避免绕过余额版本和流水幂等。
* 管理端已有充值确认、钱包调整的权限和审计模式：平台管理员跨租户，租户管理员限制本租户，动作必须写 `audit_logs`。
* PRD 明确要求管理端跟踪订单、上游请求、失败原因，并支持 retry、refund、manual 补单和审计。

## Requirements

* 提供管理端订单操作接口：
  * `POST /api/orders/:id/retry-fulfillment`
  * `POST /api/orders/:id/refund`
  * `POST /api/orders/:id/manual-complete`
* 权限：
  * `PLATFORM_ADMIN` 可操作当前站点内任意租户订单。
  * `TENANT_ADMIN` 只能操作本租户订单。
  * `USER` 不可调用这些管理动作。
* 重试履约：
  * 仅允许 `FAILED` 订单进入重试，避免正常 `PENDING` 订单重复创建履约任务。
  * 重置订单为 `PENDING`，清理 `failReason`。
  * 新建一个 `QUEUED` fulfillment job，沿用订单资源对应的 provider。
  * 写入 `order.retry_fulfillment` 审计。
* 退款：
  * 仅允许未完成退款的失败/待处理/履约中订单退款。
  * 通过钱包 CREDIT 写入 `REFUND` 流水，幂等键固定为订单维度，重复退款不重复入账。
  * 订单置为 `REFUNDED`，履约任务置为 `FAILED` 并记录原因。
  * 写入 `order.refund` 审计。
* 人工补单完成：
  * 仅允许 `PENDING` / `FULFILLING` / `FAILED` 订单人工完成。
  * 请求必须包含 `reason`。
  * 将订单置为 `COMPLETED`，必要时把最近的履约任务置为 `COMPLETED`。
  * 写入 `order.manual_complete` 审计。
  * 本任务不手工创建代理实例；真实代理补录另走代理导入/实例管理能力。

## Acceptance Criteria

* [x] 管理员重试失败订单后，订单状态为 `PENDING`，产生新的 `QUEUED` fulfillment job，并写审计。
* [x] 管理员退款失败订单后，钱包余额恢复、只产生一条 `REFUND` 流水，订单状态为 `REFUNDED`，重复调用不重复入账。
* [x] 租户管理员不能操作其他租户订单。
* [x] 用户调用管理动作返回 403。
* [x] 人工补单完成必须要求 reason，并写入审计。
* [x] 后端 typecheck、lint、相关测试通过。

## Definition of Done

* 后端 use case / controller / repository 边界清楚，不把业务迁移塞进 controller。
* 真实数据库集成测试覆盖关键状态迁移、权限和钱包幂等。
* OpenAPI/contracts 如项目脚本需要同步则同步。
* 发现的新约定回写 `.trellis/spec/`。

## Out of Scope

* 不做管理端 UI 按钮。
* 不做人工代理实例录入表单。
* 不改变 worker 自动失败退款逻辑。
* 不引入生产 fallback、mock/stub 或自动迁移旧订单。

## Technical Approach

新增订单管理操作 use case，统一处理权限、状态迁移、钱包流水、履约任务和审计。Controller 只负责路由与 DTO 绑定。订单本身、钱包流水、履约任务、审计日志均以 PostgreSQL/Prisma 为 Source of Truth，操作必须在事务中完成。

## Decision (ADR-lite)

**Context**: PRD 要求运营人员能处理上游失败单，但当前只有 worker 自动失败退款，管理端缺少显式操作入口。

**Decision**: 先实现后端三类稳定操作契约：retry/refund/manual-complete。人工补单完成只标记订单完成，不在本任务里创造代理实例，避免把“补单”和“代理导入”混成一个浅层接口。

**Consequences**: 管理端 UI 后续可以直接接入稳定 API；人工代理实例补录仍需要单独设计真实 source of truth 和校验。

## Technical Notes

* 已检查：
  * `apps/api/src/modules/orders/orders.controller.ts`
  * `apps/api/src/modules/orders/orders.repository.ts`
  * `apps/api/src/modules/orders/use-cases/create-static-proxy-order.use-case.ts`
  * `apps/api/src/modules/fulfillment/use-cases/fulfill-static-proxy.use-case.ts`
  * `apps/api/src/modules/wallet/use-cases/adjust-wallet.use-case.ts`
  * `apps/api/src/modules/payments/use-cases/confirm-payment-order.use-case.ts`
  * `packages/db/prisma/schema.prisma`
* 相关测试入口：`pnpm --filter @ipeasy/api test:integration -- apps/api/src/modules/orders/tests/...`。

## Verification

* `pnpm --filter @ipeasy/api typecheck`
* `pnpm --filter @ipeasy/api lint`
* `pnpm --filter @ipeasy/api test`
* `pnpm --filter @ipeasy/api build`
* `pnpm --filter @ipeasy/api exec vitest run --config vitest.integration.config.ts src/modules/orders/tests/admin-order-ops-integration.spec.ts`
* `pnpm --filter @ipeasy/api exec vitest run --config vitest.integration.config.ts`
* `pnpm --filter @ipeasy/api export:openapi`
* `pnpm --filter @ipeasy/contracts generate`
* `pnpm --filter @ipeasy/contracts typecheck`
* `git diff --check`

## Notes

* Full integration initially failed because `tenant-provider-accounts-integration.spec.ts` used a non-hex AES key override. The production crypto helper expects a 64-character hex key, matching the rest of the crypto tests, so the test constant was corrected and the full integration suite passed.
