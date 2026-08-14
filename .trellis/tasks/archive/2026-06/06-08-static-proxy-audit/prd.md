# Task: 静态代理生命周期审计闭环

## Goal

补齐静态代理导出与生命周期操作的后端审计，让用户导出、续费、改密、切 IP 这些高价值动作能在 Admin 审计日志中追踪到操作者、租户、目标代理、请求 ID、成功或失败原因。

## What I Already Know

- 根 PRD 明确要求：代客下单、续费搜索、切 IP 和复制导出都必须写审计；高危操作必须记录操作者、目标对象和业务对象。
- 当前 `orders`、`fulfillment`、`payments`、`tenant-provider-accounts` 已经直接写入 `audit_logs`。
- 当前 `ProxiesController.export`、`renew`、`changePassword`、`switchIp` 没有写审计。
- 当前 `/res_static/renew`、`/res_static/change_auth`、`/res_static/switch_ip` 复用同一组 proxy use case，因此审计最好放在 use case/service 层，避免 UI API 和 OpenAPI 两条入口漏写。
- 当前 `AuthenticatedContext` 对 APIKey 认证只保留 ownerId/ownerType，不保留 apiKeyId；本任务先记录业务 owner，APIKey 精确 actor 另开任务。

## Requirements

- 为 customer proxy 文本导出写审计：
  - action: `proxy.export`
  - actor: 当前用户
  - tenant/site: 来自 `AuthenticatedContext`
  - targetType: `proxy_instances`
  - meta 至少包含导出格式、导出数量，不记录代理密码或完整导出文本。
- 为静态代理生命周期操作写审计：
  - 成功续费：`proxy.renew.success`
  - 续费失败：`proxy.renew.failed`
  - 成功改密：`proxy.change_password.success`
  - 改密失败：`proxy.change_password.failed`
  - 成功切 IP：`proxy.switch_ip.success`
  - 切 IP 失败：`proxy.switch_ip.failed`
- 生命周期审计必须覆盖 UI API 和 `/res_static/*` OpenAPI 两条入口。
- 失败审计需要保留稳定 `reasonKey`、错误码和上游/能力失败原因；审计写入成功后继续抛出原始业务错误。
- 审计 meta 禁止写入 plaintext password、credential、apikey、proxy export line 等 secret-like 内容。
- 审计写入失败不能把真实 lifecycle 操作伪装成成功；当前阶段沿用项目现有模式，让数据库错误向上暴露，不做 silent catch。

## Acceptance Criteria

- [x] `GET /api/proxies/export` 成功后写入 `proxy.export` 审计，并测试不包含 plaintext password。
- [x] `ProxyLifecycleService` 成功 renew/change-password/switch-ip 时写入对应 success 审计。
- [x] `ProxyLifecycleService` 对缺上游实例 ID、adapter 不支持、上游失败等错误写入对应 failed 审计，并保留原错误。
- [x] `/res_static/renew`、`/res_static/change_auth`、`/res_static/switch_ip` 复用同一审计链路，不单独漏写。
- [x] API typecheck/lint/test 通过。

## Technical Approach

- 在 proxies 模块新增局部审计服务或 helper，集中写 `audit_logs`，避免 controller 和 lifecycle service 重复拼 meta。
- `ProxyLifecycleService.execute` 接收完整 `AuthenticatedContext`，由 use case/controller 传入 ctx；如需保留兼容，可让 use case 的 public API 改为 ctx-first。
- `ProxyLifecycleService` 在加载代理后确认归属，再执行 adapter；成功写 success audit，catch `AppError` 或未知错误时写 failed audit 后 rethrow。
- `ProxiesController.export` 在生成导出行后写 `proxy.export`，meta 只记录 `{ format, count }`。
- 测试优先补现有 `proxy-lifecycle.service.spec.ts` 和 `proxies.controller.spec.ts`，直接断言 Prisma `audit_logs.create` 写入 shape。

## Decision (ADR-lite)

**Context**: 生命周期可以从 UI API 和 OpenAPI 进入，若审计只写在 controller，会出现入口不一致。  
**Decision**: 生命周期审计落在 `ProxyLifecycleService`，导出审计落在 `ProxiesController.export`。  
**Consequences**: Use case/controller 需要传入 `AuthenticatedContext` 而不是裸 `userId`；单条复制仍是前端本地动作，暂不做服务器审计。

## Out of Scope

- 不新增单条复制审计 endpoint；当前复制 modal 是前端本地动作，后端不可观察。
- 不扩展 `AuthenticatedContext` 保存 apiKeyId；APIKey 精确审计另开任务。
- 不做批量生命周期审计，因为批量续费/改密/切 IP 还未实现。
- 不改 Admin 审计列表 UI。

## Technical Notes

- Relevant files:
  - `apps/api/src/modules/proxies/proxy-lifecycle.service.ts`
  - `apps/api/src/modules/proxies/use-cases/*.ts`
  - `apps/api/src/modules/proxies/proxies.controller.ts`
  - `apps/api/src/modules/proxies/proxies.controller.spec.ts`
  - `apps/api/src/modules/proxies/proxy-lifecycle.service.spec.ts`
  - `apps/api/src/modules/openapi/res-static.controller.ts`
  - `packages/db/prisma/schema.prisma`
- Existing audit examples:
  - `apps/api/src/modules/orders/use-cases/create-static-proxy-order.use-case.ts`
  - `apps/api/src/modules/tenants/tenant-provider-accounts.controller.ts`

## Implementation Record

- 新增 `ProxyAuditService`，集中写静态代理导出和生命周期 audit action。
- `ProxyLifecycleService` 改为接收完整 `AuthenticatedContext`，统一校验 user/site/tenant，成功和失败都写 lifecycle audit。
- `RenewProxyUseCase`、`ChangePasswordUseCase`、`SwitchIpUseCase` 改为 ctx-first 签名，UI API 和 `/res_static/*` OpenAPI 入口共用同一审计链路。
- `ProxiesController.export` 在成功构造导出文本后写 `proxy.export`，audit meta 只包含格式和数量。
- 后端 logging spec 新增 `Static Proxy Audit Logs` 场景，记录 action 命名、禁写 secret 和测试要求。

## Verification

- `pnpm --filter @ipeasy/api typecheck`
- `pnpm --filter @ipeasy/api lint`
- `pnpm --filter @ipeasy/api test`
- `pnpm --filter @ipeasy/api build`
- `git diff --check`
