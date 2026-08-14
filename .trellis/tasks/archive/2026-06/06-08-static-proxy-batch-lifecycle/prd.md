# Task: 静态代理批量生命周期后端完善

## Goal

补齐 Customer 静态代理批量续费、批量改密、批量切 IP 的后端接口和结果汇总，让前端可以展示成功项、失败项和稳定失败原因，而不是只能逐条调用单个生命周期接口。

## What I Already Know

- 根 PRD 明确要求“批量续费、改密、切 IP 必须展示成功项、失败项和失败原因”。
- 当前已有单个生命周期接口：
  - `POST /api/proxies/:id/renew`
  - `POST /api/proxies/:id/change-password`
  - `POST /api/proxies/:id/switch-ip`
- 单个生命周期动作通过 `RenewProxyUseCase`、`ChangePasswordUseCase`、`SwitchIpUseCase` 调用 `ProxyLifecycleService`，已有权限校验、上游能力判断、代理更新和审计。
- 批量接口不应绕过现有生命周期 use case，否则审计和上游错误映射会漂移。
- 当前 `.trellis/tasks/18-reseller-admin-ui/` 是未识别遗留目录，本任务不触碰、不提交。

## Requirements

- 新增 Customer API：
  - `POST /api/proxies/batch-renew`
  - `POST /api/proxies/batch-change-password`
  - `POST /api/proxies/batch-switch-ip`
- 请求体：
  - 批量续费：`{ proxyIds: string[]; durationDays: number; idempotencyKey?: string }`
  - 批量改密：`{ proxyIds: string[] }`
  - 批量切 IP：`{ proxyIds: string[] }`
- `proxyIds` 必须是非空数组；不允许空数组、非数组或空字符串 ID。
- 批量续费 `durationDays` 必须是正整数。
- 每个 proxyId 逐个调用现有单项 use case：
  - 单项成功 -> 结果项包含 `proxyId`、`success: true`、`proxy`。
  - 单项失败 -> 结果项包含 `proxyId`、`success: false`、`error: { code, reasonKey, httpStatus }`。
- 总响应包含 `totalCount/successCount/failureCount/items`。
- 批量结果中的成功 proxy 使用与单项接口一致的 delivery DTO，包含解密后的密码；失败项不得泄漏其他用户代理详情。
- 单项 use case 已有审计，本任务不新增批量总审计，避免重复和歧义。
- 不改变现有单项接口行为。

## Acceptance Criteria

- [x] 批量续费成功/失败混合时返回每项结果和正确计数。
- [x] 批量改密和批量切 IP 复用现有单项 use case。
- [x] 非法 `proxyIds` 和非法 `durationDays` 返回 `VALIDATION_ERROR`。
- [x] 单项 `AppError` 被映射为 item-level error，不中断后续 proxyId。
- [x] 成功项 DTO 与单项 Customer delivery DTO 一致并只在响应边界解密密码。
- [x] 单元测试覆盖成功/失败混合、输入校验、单项错误映射。
- [x] API typecheck/lint/test/build 通过。

## Technical Approach

- 新增 `BatchProxyLifecycleUseCase`，只做批量编排和输入校验，不直接访问 Prisma 或 Provider。
- `BatchProxyLifecycleUseCase` 注入现有 `RenewProxyUseCase`、`ChangePasswordUseCase`、`SwitchIpUseCase`。
- 批量续费如传入 `idempotencyKey`，每个 item 调用时派生为 `${idempotencyKey}:${proxyId}`，避免多个上游动作共用同一个 key。
- `ProxiesController` 新增三个 batch route，调用 batch use case 后用现有 `toDeliveryDto` 映射成功项。
- 新增 `batch-proxy-lifecycle.use-case.spec.ts` 覆盖 use case 汇总逻辑；扩展 `proxies.controller.spec.ts` 覆盖 route DTO 映射。

## Decision (ADR-lite)

**Context**: 单个生命周期动作已经是权限、上游能力、审计和本地代理更新的 source of truth。  
**Decision**: 批量 use case 只编排现有单项 use case 并收集结果，不复制底层生命周期逻辑。  
**Consequences**: 批量接口自然继承单项行为和审计；如果后续需要并发/限流/异步批处理，可以替换 batch use case 内部执行策略，不影响 controller 和单项 use case。

## Out of Scope

- 不做 Admin 跨用户批量生命周期。
- 不做 `/res_static/*` 批量生命周期兼容接口。
- 不做异步任务、进度查询、并发执行或队列化。
- 不修改单项生命周期 service 的 provider 行为。
- 不触碰 `.trellis/tasks/18-reseller-admin-ui/` 未识别目录。

## Technical Notes

- Relevant files:
  - `apps/api/src/modules/proxies/proxies.controller.ts`
  - `apps/api/src/modules/proxies/proxies.module.ts`
  - `apps/api/src/modules/proxies/use-cases/renew-proxy.use-case.ts`
  - `apps/api/src/modules/proxies/use-cases/change-password.use-case.ts`
  - `apps/api/src/modules/proxies/use-cases/switch-ip.use-case.ts`
  - `apps/api/src/modules/proxies/proxies.controller.spec.ts`
- Related specs:
  - `.trellis/spec/backend/database-guidelines.md`
  - `.trellis/spec/backend/logging-guidelines.md`
  - `.trellis/spec/guides/cross-layer-thinking-guide.md`

## Implementation Record

- 新增 `BatchProxyLifecycleUseCase`，只负责批量入参校验、逐项调用现有单项 use case、汇总 `totalCount/successCount/failureCount/items`。
- 新增 Customer 批量接口：`POST /api/proxies/batch-renew`、`POST /api/proxies/batch-change-password`、`POST /api/proxies/batch-switch-ip`。
- 批量成功项在 controller 响应边界复用单项 Customer delivery DTO 解密密码；失败项只返回 `{ code, reasonKey, httpStatus }`。
- 批量续费将请求级 `idempotencyKey` 派生为 `${idempotencyKey}:${proxyId}`，避免多个上游动作共用同一个 key。
- 未新增批量总审计；每个成功/失败项继续由现有单项 use case/`ProxyLifecycleService` 写审计。
- 更新 `.trellis/spec/backend/database-guidelines.md` 和 `.trellis/spec/backend/logging-guidelines.md`，记录批量生命周期契约。

## Verification

- `pnpm --filter @ipeasy/api typecheck`
- `rtk pnpm --filter @ipeasy/api lint`
- `rtk pnpm --filter @ipeasy/api test`（19 files / 87 tests passed）
- `rtk pnpm --filter @ipeasy/api build`
- `rtk git diff --check`
