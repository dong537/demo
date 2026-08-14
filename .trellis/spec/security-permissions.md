# 安全、权限与审计规范

## 统一认证上下文

所有请求进入 use case 前必须解析为 `AuthenticatedContext`。

必须提供 guard：

- `requireAuthenticatedContext`
- `requireUserContext`
- `requireOperatorContext`
- `requireTenantAdminContext`
- `requirePlatformAdminContext`
- `requireSystemContext`

## 权限规则

- `/system/*` 必须先过 `requireOperatorContext`，不能仅凭 scope。
- `USER` ownerType 禁止持有 `system:*` scope。
- tenant admin 只能访问本 tenant 数据。
- platform admin 可以跨 tenant，但写操作必须审计。
- 用户端只能读写自己的订单、钱包、代理、工单。
- 前端权限只影响可见性，不作为真实权限判断。

## APIKey

- APIKey 明文只展示一次。
- 数据库存储 key hash，不存明文。
- APIKey 必须有 owner、scopes、ip whitelist、status、createdAt、rotatedAt。
- 禁止 placeholder key 进入生产路径。
- 生产必须设置 `ALLOW_PLACEHOLDER_APIKEYS=false` 和 `ALLOW_LOCAL_DEV_APIKEY=false`。
- USER 和 TENANT_ADMIN 只能为自己的 `tenantId` 创建 APIKey；即使 request body 传入其他 tenant，也必须返回 403。

## 用户改密

- 改密必须先 `bcrypt.compare` 校验旧密码；错误返回统一 AppError（如 `old_password_incorrect`），不区分"用户不存在 vs 密码错"，不泄露账户存在性。
- 新密码 `bcrypt.hash` 用生产 cost ≥10（测试的 cost=4 仅限测试），禁止明文存储。
- 新密码需基本强度校验（最小长度 8，`password_too_weak`），且不得与旧密码相同（`password_reuse`，用 bcrypt.compare 命中即拒）。
- 改密成功后吊销该用户其它 session（`sessions.revokedAt`，按 ownerId 排除当前 sessionId），当前设备保留登录，并提示其它设备需重新登录。
- 改密写审计 `auth.change_password`。
- `GET/PUT /api/users/me` 响应绝不含 `passwordHash`；`PUT /users/me` 不放开 `email`（避免 @unique 冲突），仅改 name/phone。

## 站内通知

- 通知必须有真实产生源（领域事件），禁止空收件箱假数据。当前唯一产生源 = admin 工单回复。
- 通知按 `userId + siteId + tenantId` 隔离；列表/未读数/标记已读只能操作自己的通知，越权 `NOT_FOUND`（不泄露存在性），标记已读幂等。
- PLATFORM_ADMIN 触发的通知产生（如回复工单）必须用目标实体（ticket）的真实 `tenantId`，不能用 admin 自身可能为 null 的 tenant。
- 通知写入失败不回滚主操作（如工单回复），但必须记 error 日志，禁止 silent 吞错。

## Provider 健康

- Provider 健康/连通测试仅 PLATFORM_ADMIN；按 `siteId` 归属校验，越权 `NOT_FOUND`。
- 凭据解密只在探测边界用于构建 runtime config，绝不进响应 DTO、审计 meta、日志。
- 探测目标 baseUrl 来自 DB（admin 配置），非请求参数；adapter 必须 `assertSafeUrl`（仅 https、拒私网/loopback）防 SSRF。
- 探测失败（连不上/超时/解密失败）收敛为 `{reachable:false, reasonKey}` HTTP 200，不抛 500；仅权限/归属错误抛 AppError。

### 1. Scope / Trigger

- Trigger: Auth / Session / APIKey / RBAC 是所有业务接口的入口契约，任何漂移都会绕过权限或审计。

### 2. Signatures

- `POST /api/auth/login` -> `{ token, expiresAt }`，token 是 opaque session token。
- `POST /api/auth/logout` -> revoke 当前 session。
- `POST /api/api-keys` -> `{ id, keyPrefix, scopes, ipWhitelist, status, createdAt, plainKey }`，`plainKey` 只在创建响应出现。
- `DELETE /api/api-keys/:id` -> revoke APIKey。
- Guard decorators: `@RequireAuth()`、`@RequireUser()`、`@RequireOperator()`、`@RequireTenantAdmin()`、`@RequirePlatformAdmin()`、`@RequireSystem()`。
- Context decorator: `@CurrentContext() ctx: AuthenticatedContext`。

### 3. Contracts

- Session token:
  - Plain token: `crypto.randomBytes(32).toString("hex")`。
  - DB stores only `sha256(plainToken)` in `sessions.token`。
  - `sessions.expiresAt` controls expiry; `sessions.revokedAt` controls logout/revoke.
- APIKey:
  - Plain key: `crypto.randomBytes(32).toString("hex")`。
  - DB stores `sha256(plainKey)` in `api_keys.keyHash` and `plainKey.slice(0, 8)` in `keyPrefix`。
  - `ipWhitelist = []` means unrestricted; non-empty list means strict match against request IP.
  - `status !== ACTIVE` cannot authenticate.
- `AuthenticatedContext` is attached to Fastify request as `authContext`; session auth also sets `sessionId` for logout.

### 4. Validation & Error Matrix

- Wrong password -> 401 `AUTH_REQUIRED` / `invalid_credentials`。
- Missing token/APIKey -> 401 `AUTH_REQUIRED`。
- Missing session row -> 401 `AUTH_REQUIRED` / `session_not_found`。
- Expired or revoked session -> 401 `AUTH_REQUIRED` / `session_expired`。
- Missing/revoked APIKey -> 401 `AUTH_REQUIRED` / `invalid_api_key`。
- APIKey IP whitelist mismatch -> 403 `PERMISSION_DENIED` / `ip_not_whitelisted`。
- USER/TENANT_ADMIN creating APIKey for another tenant -> 403 `PERMISSION_DENIED` / `insufficient_permissions`。
- USER with `system:*` scope hitting `@RequireSystem()` route -> 403 `PERMISSION_DENIED` / `insufficient_permissions`。

### 5. Good/Base/Bad Cases

- Good: create session/key, store hash only, return plain secret once, write audit log.
- Base: authenticated user can access allowed endpoints; tenant admin can read own tenant only.
- Bad: duplicated strategy classes with the same names in different files; one will drift from the injected provider.

### 6. Tests Required

- Integration tests must cover wrong password, missing token, expired session, revoked session.
- Integration tests must cover tenant admin cross-tenant denial and platform admin audit creation.
- APIKey integration tests must cover hash-only storage, tenant-bound creation, IP whitelist mismatch, revoked key denial.
- System guard integration must cover USER with `system:*` scope still denied.

### 7. Wrong vs Correct

#### Wrong

```ts
if (ctx.ownerType === 'TENANT_ADMIN' && ctx.tenantId !== dto.tenantId) {
  throw forbidden();
}
```

This lets USER create APIKeys for arbitrary tenants.

#### Correct

```ts
if (ctx.tenantId !== dto.tenantId) {
  throw forbidden();
}
```

Both USER and TENANT_ADMIN are tenant-bound. PLATFORM_ADMIN is not an allowed APIKey owner in the first-stage create flow.

## Secret 边界

- 上游 APIKey、Provider 凭据、支付密钥必须加密存储。
- Secret 不进入日志、OpenAPI、测试快照、前端 bundle。
- Web 服务只允许公开配置；API/Worker 才能读取数据库、JWT、Provider、Payment、APIKey secret。

## Provider 安全

- Provider baseUrl 必须做 SSRF 校验：协议、host、私网地址、危险重定向。
- Provider credential 从统一配置服务读取。
- 页面、route、use case 禁止直接读 `process.env`。
- 上游请求/响应必须脱敏写入 `upstream_request_logs`。

## 客户面探测 / owned-resource 端点

任何让客户触发出站网络探测的端点（如 `POST /api/proxy-check`）必须按以下边界设计，杜绝 SSRF：

- 入参只接 owned-resource id（如 `{ proxyId }`），**禁止接受客户端传入的裸 host/port/protocol/url**。
- 资源必须经 `ownerId + siteId + tenantId` 三重归属校验；非自己名下 → `NOT_FOUND`（不泄露存在性），不返回 403 暴露资源存在。
- 出站目标固定，由运维 env 控制（如 `PROXY_CHECK_TARGET_URL`），不可被请求参数改写，不硬编码进业务代码。
- 代理出口取自数据库行（由上游履约写入，用户无法自填 ip/port），避免二级 SSRF。
- 凭据（代理密码等）AES 解密只在 use case 边界；响应 DTO、`audit_logs.meta`、日志均不回显凭据/完整代理 URL。
- 探测失败（连不上/超时）是正常业务结果，收敛为 `{ reachable: false, error }` + HTTP 200，**不抛 500**；仅归属/权限/参数错误抛 `AppError`。必须有超时、单次、无重试风暴。
- 探测库用成熟 pin 版本依赖（如 `https-proxy-agent` / `socks-proxy-agent`），禁止自造裸 socket 协议实现。

## 审计

必须审计：

- APIKey 签发、禁用、轮换。
- 钱包充值、扣款、调账、退款。
- platform admin 跨租户操作。
- tenant brand 更新。
- impersonation。
- Provider credential rotate。
- 订单重试、退款、补单。
- 代客下单、续费搜索、切 IP、复制导出。
- 工单建单 / 回复 / 关闭（`ticket.create` / `ticket.reply` / `ticket.close`）。
- 客户代理连通性检测（`proxy.check`）。

审计记录至少包含：

- actor
- tenant/site
- target user
- business object
- action
- reason
- requestId
- createdAt

## 必测权限场景

- USER 不能访问 `/system/*`。
- tenant admin 不能跨 tenant。
- platform admin 操作产生 audit log。
- 权限错误不能变成空数据或默认成功。
- `GET /api/tenants/:id/brand` 可公开读取，但只能返回品牌公开字段。
- `PUT /api/tenants/:id/brand` 只能由 TENANT_ADMIN 更新自己租户，或 PLATFORM_ADMIN 更新当前 site 内 tenant。
- 客户只能 list/读取/操作自己名下的 APIKey 和工单；他人/他租户的资源在 repository 层即按 `ownerId + siteId + tenantId` 过滤，越权返回 `NOT_FOUND`。
- `POST /api/proxy-check` 只接受自己名下 proxyId 的探测；他人代理返回 `NOT_FOUND`，响应与审计不含代理凭据。
