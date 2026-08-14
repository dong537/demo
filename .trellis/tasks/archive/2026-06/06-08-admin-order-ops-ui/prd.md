# 管理端订单故障处置 UI

## Goal

把已经落地的管理端订单故障处置后端能力接入 Admin 订单列表，让运营人员不再手动调用接口处理失败订单，可以在真实订单上下文里执行重试履约、退款和手动补单，并看到明确的成功/失败反馈。

## Requirements

- 在 `apps/web/src/features/admin-orders/order-list.feature.tsx` 的订单操作区新增三个真实操作入口：
  - `FAILED` 订单可重试履约，调用 `POST /api/orders/:id/retry-fulfillment`。
  - `FAILED`、`PENDING`、`FULFILLING` 订单可退款，调用 `POST /api/orders/:id/refund`。
  - `FAILED`、`PENDING`、`FULFILLING` 订单可手动完成，调用 `POST /api/orders/:id/manual-complete`。
- 退款和手动完成必须弹出确认表单并要求填写原因；重试履约允许填写原因但不强制。
- 操作成功后必须刷新订单列表和当前订单履约详情缓存，展示后端返回的状态、履约任务 ID 或钱包余额变化。
- 操作失败必须展示后端 `reasonKey`，不能吞错、不能当作空状态或成功。
- `tenantId` 作用域必须沿用现有 `OrderListFeature` 的查询上下文，TENANT_ADMIN 在租户详情页或自身后台只能操作其租户内订单，权限边界由后端接口兜底。
- 所有用户可见文案走现有 i18n 文件，不在组件里硬编码中文/英文业务文案。
- 新增或更新前端测试，覆盖按钮可见性、必填原因、接口路径和成功后刷新。

## Acceptance Criteria

- [ ] 订单列表中的失败单显示“查看履约 / 重试 / 退款 / 手动完成”操作。
- [ ] 非可处理状态不显示不合法操作入口。
- [ ] 退款和手动完成不填写原因时不会发请求。
- [ ] 三个操作使用真实 `apiRequest` POST 到后端新增接口。
- [ ] 成功后调用 TanStack Query 刷新订单列表；如果履约抽屉打开，也刷新履约详情。
- [ ] API 错误以 Ant Design 反馈展示，不被静默处理。
- [ ] `pnpm --filter @ipeasy/web test -- admin-order`、`typecheck`、`lint` 和 `build` 通过。

## Source of Truth

- 订单状态、可退款性、最终状态和钱包余额以 API 返回为准。
- 前端只做操作入口显隐和提交 UX，不在本地伪造订单结果、不生成代理实例、不自行修改钱包余额。
- 审计、资金幂等和履约任务创建由后端 `AdminOrderOperationsUseCase` 负责。

## Module Boundaries

- `OrderListFeature`：页面编排、列表查询、操作入口、mutation 后缓存刷新。
- 新增近处组件或 helper：订单操作弹窗、可操作状态判定、结果渲染。
- `shared/api/client.ts`：继续作为唯一请求入口，不新增旁路 fetch。
- i18n：`apps/web/src/shared/i18n/zh.ts` 和 `en.ts` 维护文案。

## Interface Contracts

- `POST /api/orders/:id/retry-fulfillment`
  - body: `{ reason?: string }`
  - response: `{ orderId, status, fulfillmentJobId? }`
- `POST /api/orders/:id/refund`
  - body: `{ reason: string }`
  - response: `{ orderId, status, wallet?: { available, currency } }`
- `POST /api/orders/:id/manual-complete`
  - body: `{ reason: string }`
  - response: `{ orderId, status, fulfillmentJobId? }`
- 错误形状沿用 `ApiError.reasonKey`。

## Data Flow

Admin order list -> user selects operation -> local form state collects reason -> `apiRequest` POST -> backend use case validates/changes DB -> frontend invalidates `admin-orders` and `order-fulfillment` queries -> table/drawer re-read server state -> AntD message/modal shows outcome.

## Out of Scope

- 不新增订单详情独立页面。
- 不做批量订单故障处置。
- 不新增后端接口或改后端资金/履约语义。
- 不把操作结果写入本地乐观状态。
- 不处理 `.trellis/tasks/18-reseller-admin-ui/` 的历史孤立任务目录。

## Technical Notes

- 后端接口和 OpenAPI 已在 `06-08-admin-order-ops-backend` 完成并归档。
- 当前入口文件：
  - `apps/web/src/routes/admin/orders/index.tsx`
  - `apps/web/src/features/admin-orders/order-list.feature.tsx`
  - `apps/web/src/features/admin-orders/fulfillment-detail.feature.tsx`
- 当前 API client：`apps/web/src/shared/api/client.ts`。
- 当前测试样式参考：`apps/web/src/features/admin-tenants/tests/tenant-scoped-lists.spec.tsx`。
