# Task 16 技术设计：Reseller 上游 Provider API Key 管理

## 目标

- 允许 `TENANT_ADMIN` 管理自己租户级别的原生 provider 凭证。
- `PLATFORM_ADMIN` 可以在当前 `siteId` 内管理任意 tenant 的 provider 凭证，并写审计。
- 订单履约读取 provider 凭证时优先使用 tenant 级 `provider_accounts`，没有可用 tenant 账号时回退到 site 全局账号。

## 不做

- 不改 `upstream_api_accounts` 的职责。它已经用于 985-compatible `UPSTREAM_API` 上游账号，并支持 tenant/public 选择。
- 不在 API 响应、OpenAPI 示例、日志或测试快照中返回明文 credential/API key。
- 不接受客户端传入的 `siteId` 作为权限或数据边界。

## Source of Truth

- 原生 provider 凭证源：PostgreSQL `provider_accounts`。
- `provider_accounts.siteId` 来自 `AuthenticatedContext.siteId`。
- 新增 `provider_accounts.tenantId?: string` 表示 tenant 级覆盖；`null` 表示 site 全局账号。
- 凭证明文只在控制器入口接收一次，使用 `APP_ENCRYPTION_KEY` AES-GCM 加密为 `credentialEncrypted`。
- 履约读取路径：`ProviderRegistryService.getConfig(providerCode, siteId, tenantId?)`。
- 985-compatible 上游转卖路径继续使用 `ProviderRegistryService.getConfigForUpstreamAccount(siteId, tenantId)` 和 `upstream_api_accounts`。

## 模块边界

- DB/migration：`packages/db/prisma/schema.prisma` 和新 Prisma migration。
- Repository：新增 tenant provider account repository，封装 `provider_accounts` 读写和 DTO 映射，避免控制器泄漏 `credentialEncrypted`。
- API：新增 `GET/POST/PUT/DELETE /api/tenants/:id/provider-accounts`。
- Registry：统一实现 tenant 优先、site 兜底、禁用账号不参与选择、凭证解密失败显式 `INTERNAL_ERROR`。
- Fulfillment：原生 provider fallback 时传入 `order.tenantId`。
- Audit：platform admin 和 tenant admin 写操作都写 `audit_logs`，租户字段为目标 tenant。

## API 契约

- `GET /api/tenants/:id/provider-accounts` 返回该 tenant 的账号列表，不包含 `credentialEncrypted` 或明文凭证。
- `POST /api/tenants/:id/provider-accounts` body:
  - `providerCode`: `IPIPD | NINE_EIGHT_FIVE | PR`
  - `credential`: provider 所需键值对象
  - `baseUrl`: HTTPS URL，必须通过 SSRF 校验
  - `timeoutMs?`
  - `inventorySyncEnabled?`
- `PUT /api/tenants/:id/provider-accounts/:accountId` 支持局部更新 `credential/baseUrl/status/timeoutMs/inventorySyncEnabled`。
- `DELETE /api/tenants/:id/provider-accounts/:accountId` 软禁用账号，保留审计和历史引用。
- `TENANT_ADMIN` 只能访问 `ctx.tenantId`；跨租户返回 `TENANT_SCOPE_VIOLATION`。
- `PLATFORM_ADMIN` 只能访问当前 `ctx.siteId` 内存在的 tenant；跨站 tenant 返回 `NOT_FOUND / tenant_not_found`。

## 风险与验证

- 凭证泄漏：DTO 映射必须排除 `credentialEncrypted`，日志/audit meta 不写 credential。
- 错误账号选择：registry 查询必须先查 tenant active，再查 site global active；禁用 tenant 账号不阻断 site fallback。
- SSRF：create/update baseUrl 入口调用 `assertSafeUrl`。
- DB 迁移：只通过 Prisma schema/migration 修改，不用 `db push`。
- 验证门禁：API typecheck/lint/test/build、OpenAPI export、contracts generate/typecheck、`git diff --check`。集成测试需要真实 PostgreSQL，若本地 env 不可用则记录失败原因。
