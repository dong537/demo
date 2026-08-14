# Task 05 — Auth / Session / APIKey / RBAC

## 目标

实现邮箱密码登录、Session 管理、APIKey 签发与校验，把 `AuthenticatedContext` 注入每个请求，并用 NestJS Guard 装饰器统一执行权限校验。

## 实现要求

### 登录（Session）

**use-cases/login.use-case.ts**
1. 接收 `{ email, password, siteId }`
2. 从 `users` 或 `admin_users` 查找，验证 passwordHash（`bcrypt.compare`）
3. 创建 `sessions` 记录：token = `crypto.randomBytes(32).toString('hex')` 的 SHA-256 hash，expiresAt = now + 7d
4. 明文 token 只在此返回一次，不再存储
5. 写 `audit_logs`：`action: 'auth.login'`
6. 失败时 throw `AppError(AUTH_REQUIRED, 'invalid_credentials', 401)`

**use-cases/logout.use-case.ts**
- 设置 `sessions.revokedAt = now`
- 写 audit log `auth.logout`

**auth.repository.ts**
- `findSessionByTokenHash(hash): Session | null`
- `createSession(data): Session`
- `revokeSession(id): void`
- 禁止返回 null 冒充 not found；not found 时 throw `AppError(AUTH_REQUIRED, 'session_not_found', 401)`

**auth.controller.ts**
- `POST /api/auth/login` — 不需要认证
- `POST /api/auth/logout` — 需要 `@RequireAuth()`

### JWT Strategy

`jwt.strategy.ts`：从 `Authorization: Bearer <token>` 提取 token，SHA-256 hash 后查 sessions 表，返回 `AuthenticatedContext`。  
验证：session 未过期、未撤销；找不到 → throw `AUTH_REQUIRED`。

### APIKey Strategy

`apikey.strategy.ts`：从 `apikey` header 提取，SHA-256 hash 后查 `api_keys` 表，构建 `AuthenticatedContext`（ownerType 从 api_key.ownerType 映射）。  
验证：status=ACTIVE；ip whitelist（如配置）。  
写 `api_keys.lastUsedAt`。

### Guards（apps/api/src/common/auth/guards.ts）

```ts
// 装饰器（组合 UseGuards + SetMetadata）
@RequireAuth()           // 任意已认证身份，只检查 session/apikey 有效
@RequireUser()           // ownerType === USER
@RequireOperator()       // ownerType === PLATFORM_ADMIN or SYSTEM
@RequireTenantAdmin()    // ownerType === TENANT_ADMIN，自动注入 tenantId 校验
@RequirePlatformAdmin()  // ownerType === PLATFORM_ADMIN
@RequireSystem()         // ownerType === SYSTEM
```

每个 Guard 在失败时统一 throw `AppError(PERMISSION_DENIED, 'insufficient_permissions', 403)`。  
`USER ownerType` 若持有 `system:*` scope → throw `PERMISSION_DENIED`（在 RequireSystem guard 里检测并拒绝）。

### @CurrentContext() 装饰器

```ts
@CurrentContext() ctx: AuthenticatedContext
```

从 NestJS request 对象取出已解析的 context，供 controller method 参数使用。

### APIKey 管理

**create-api-key.use-case.ts**
1. 校验调用者是 USER 或 TENANT_ADMIN（只能给自己的 tenant 创建）
2. 生成 `crypto.randomBytes(32).toString('hex')` 明文 key
3. `keyPrefix = key.slice(0, 8)`，`keyHash = sha256(key)`
4. 写 `api_keys`
5. 写 audit log `api_key.create`
6. **明文 key 只在此响应一次**，response DTO 里有 `plainKey?: string`，后续查询不返回

**revoke-api-key.use-case.ts**
- 校验 caller 是 owner 或 PLATFORM_ADMIN（platform admin 跨租户必须审计）
- 设置 `status = REVOKED`，`revokedAt = now`
- 写 audit log `api_key.revoke`

## 必须测试（apps/api/src/modules/auth/tests/auth.spec.ts）

使用 Supertest + 真实测试库（Testcontainers 或本地测试 DB）：

```ts
it('USER 不能访问 /system/* 路径')
it('错误密码返回 401 AUTH_REQUIRED')
it('过期 session 返回 401')
it('已撤销 session 返回 401')
it('TENANT_ADMIN 不能访问其他 tenant 的资源')
it('PLATFORM_ADMIN 操作产生 audit_log')
it('USER scope 不能包含 system:* scope')
it('apikey IP whitelist 不匹配时返回 403')
```

## 验证步骤

```bash
pnpm --filter @ipeasy/api typecheck
pnpm --filter @ipeasy/api test              # 单元测试通过
pnpm --filter @ipeasy/api test:integration  # Supertest 权限测试通过
```

## 禁止

- 不存储明文 token 或明文 apikey
- 不在 guard 失败时返回空数据或默认成功
- 不跳过 ip whitelist 校验（配置为空 = 不限制；配置不为空 = 严格匹配）
- 不用 `jwt.sign` 把 userId 直接放进 token payload（token 是 opaque session token）

## 实现记录（2026-06-08）

- 修正 APIKey 创建边界：`USER` 和 `TENANT_ADMIN` 都只能为自身 `tenantId` 创建 key。
- 删除未被模块引用的重复 auth strategy 文件，避免两套 `JwtStrategy` / `ApiKeyStrategy` 漂移。
- 补齐真实集成测试：错误密码、缺失 token、过期 session、撤销 session、tenant admin 跨租户、platform admin 审计、APIKey hash-only 存储、跨租户创建拒绝、IP whitelist 拒绝、撤销 key 拒绝、USER 持有 `system:*` 仍不能访问系统路由。
- 更新 `.trellis/spec/security-permissions.md` 的 Auth/APIKey/RBAC 可执行契约；更新 `.trellis/spec/testing-deployment.md` 的 Windows Prisma generate 并发门禁说明。

已运行验证：

```bash
pnpm --filter @ipeasy/api typecheck
pnpm --filter @ipeasy/api lint
pnpm --filter @ipeasy/api test:integration
pnpm lint
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

注意：Windows 本地不要并发运行会触发 Prisma generate 的根级 `pnpm typecheck` 和 `pnpm build`，否则可能因 Prisma engine DLL rename 出现 `EPERM`；本次已改为串行重跑并通过。
