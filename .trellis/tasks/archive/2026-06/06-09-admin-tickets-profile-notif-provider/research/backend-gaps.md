# Research: 后端现状与缺口（管理员工单 / 用户自助资料改密 / 消息通知 / Provider 健康与请求日志）

- **Query**: 为 4 个候选全栈功能逐一调研 apps/api 后端真实现状，判断前端能否做、要不要先补后端
- **Scope**: internal（apps/api + packages/db prisma + packages/contracts 交叉验证）
- **Date**: 2026-06-09

## 调研方法

遍历 `apps/api/src/modules/*` 的 controller/use-case/repository，对照 `packages/db/prisma/schema.prisma`（690 行）与 `packages/contracts/openapi.json` 的已注册路由。结论按"表/接口是否存在"取证，不臆测。

---

## 1. 管理员工单工作台

### 现状（已有的表/接口）

- 表已就绪，且已支持 admin 作者：
  - `tickets`（`schema.prisma:662`）：含 `siteId / tenantId / userId / subject / status`，索引 `@@index([siteId, tenantId, userId])` + `@@index([status])`。
  - `ticket_messages`（`schema.prisma:678`）：`authorType` 字段类型为枚举 `TicketMessageAuthorType { USER, ADMIN_USER }`（`schema.prisma:106-109`）。**ADMIN_USER 已是合法值，schema 不需要改。**
- 接口全部是客户侧、USER only：
  - `tickets.controller.ts` 暴露 `GET /tickets`、`POST /tickets`、`GET /tickets/:id`、`POST /tickets/:id/messages`、`POST /tickets/:id/close`，每个都 `@RequireAuth()`。
  - 归属校验 `requireTicketOwner(ctx)`（`tickets/access.ts:15`）**硬卡 `ctx.ownerType !== 'USER'` 抛 403**，并按 `ownerId` 收窄。
  - 仓库层把作者写死：`tickets.repository.ts` 的 `createWithFirstMessage`（:41）和 `appendUserMessage`（:118）都硬编码 `authorType: 'USER'`；`listForOwner`（:53）、`getOwned`（:92）、`getOwnedWithMessages`（:78）全部按 `owner.ownerId` 过滤，**没有按 siteId/tenantId 列全部工单的方法**。
  - `reply-ticket.use-case.ts` 审计写死 `actorType: 'USER'`、`appendUserMessage`。
- `apps/api/src/modules/admin/` 目录**只有 `tests/`，没有任何 controller**。contracts 里也只有 4 条 `/api/tickets*` 客户路由（`openapi.json:1858-1930`），无 admin 工单路由。

### 缺口（前端必须先补的后端）

- 新增 admin 工单读写路由（建议新 `admin` 工单 controller 或 tickets 模块加 admin 段）：
  - 列表：按 `PLATFORM_ADMIN` = 全 site / `TENANT_ADMIN` = 本 tenant 范围列工单（参考 `users.controller.ts:24-30`、`upstream-accounts.controller.ts:26-37` 的分支模式）。
  - 详情：放开归属校验，从 `requireTicketOwner` 改为租户范围校验。
  - 回复：新增 `appendAdminMessage`（写 `authorType: 'ADMIN_USER'`、`authorId = ctx.ownerId`、审计 `actorType: 'ADMIN_USER'`）。
  - 改状态：现有只有 `close`，admin 工作台通常需要 OPEN/PENDING/CLOSED 的状态流转端点。
- 仓库层新增租户范围查询方法（不带 ownerId 过滤），mapper 复用现有 `toTicketDetail`。

### 安全约束

- 必须保留 site/tenant 隔离：TENANT_ADMIN 只能看本 tenant，PLATFORM_ADMIN 看本 site。沿用项目已有的 ownerType 分支 + `requireTenantId(ctx)` 模式，不要放开成全平台。

### 工作量评估：**小～中**

补端点 + 仓库方法即可，**无需新表、无需迁移**（authorType.ADMIN_USER 已存在）。主要是新 controller + 2~3 个 use-case + 租户范围仓库方法。

### 能否纯前端做：**否**

客户端点全是 USER-only 且按 ownerId 收窄，admin token 调用会被 `requireTicketOwner` 直接 403。差一组 admin 路由 + 放开归属校验 + admin 回复写 ADMIN_USER。

---

## 2. 用户自助资料 / 改密

### 现状（已有的表/接口）

- `users` 表（`schema.prisma:168`）：字段为 `email / passwordHash / status / kycStatus / riskStatus`，**没有 name / nickname / phone / avatar 等可编辑资料字段**。
- `users.controller.ts` **只有 admin 侧 `GET /users` 列表**（PLATFORM_ADMIN / TENANT_ADMIN），无 `/users/me`、无编辑、无改密。`users` 模块没有 use-cases 目录。
- `auth.controller.ts`：只有 `POST /auth/login`、`GET /auth/me`、`POST /auth/logout`。`GET /auth/me` 仅回 `ownerId/ownerType/siteId/tenantId/scopes`（来自 token 上下文，**不含 email 等用户资料**）。auth use-cases 只有 `login` / `logout`，**没有改密端点**。
- 密码存储：字段 `passwordHash`（users 与 admin_users 都有）。哈希算法 = **bcryptjs**：
  - 校验：`login.use-case.ts:27` `bcrypt.compare(password, record.passwordHash)`。
  - 生成：目前仅在测试 `integration-setup.ts:133,164` 用 `bcrypt.hash(..., 4)`，**生产代码里没有任何"写 passwordHash"的注册/改密路径**。
- contracts 无 `/users/me`、无 `change-password` 路由。（`openapi.json` 里出现的 `change-password` 是 `/api/proxies/{id}/change-password` 与 `batch-change-password`，那是代理实例凭据改密，**与用户登录密码无关**。）

### 缺口（前端必须先补的后端）

- 查看资料：新增 `GET /users/me`（返回当前 USER 的真实资料）。注意 `GET /auth/me` 只是 token 上下文，不够。
- 改密：新增 `POST /auth/change-password`（或 `/users/me/password`）：校验旧密码（`bcrypt.compare`）→ 生成新哈希（`bcrypt.hash`）→ 写回 `users.passwordHash`。
- 编辑资料：若要"编辑资料"超出 email，需先给 `users` 表加可编辑字段（name/phone 等）+ 迁移；若只改 email 则需处理 `@unique` 冲突。

### 安全约束（改密重点）

- **必须校验旧密码**后才允许改新密码，杜绝凭 session 直接重置。
- 哈希必须走 bcryptjs，**禁止明文 / 弱 cost**；生产改密用合理 cost（测试里的 cost=4 仅供测试，生产应用默认 10+）。
- 改密后建议吊销其它 session（`sessions` 表有 `revokedAt`），并写 `audit_logs`（`action: 'auth.change_password'`，沿用 login 的审计模式 `login.use-case.ts:49`）。
- 旧密码错误要走统一错误形状（`AppError(ErrorCode...)`），不要泄露账户是否存在。

### 工作量评估：**小（仅改密）～中（含资料编辑+加字段）**

- 仅"查看 + 改密"：新增 1~2 个端点 + use-case，复用现有 bcryptjs，**无需新表**（除非要扩展可编辑资料字段）。
- "编辑资料"若超出 email：需 `users` 加字段 + 迁移 = 中。

### 能否纯前端做：**否**

无 `/users/me`、无改密端点、生产无写 passwordHash 路径。前端最多能展示 `/auth/me` 的上下文（不含 email），改密完全没有后端可调。

---

## 3. 消息通知（站内信 / 未读计数 / 通知列表）

### 现状（已有的表/接口）

- **完全没有**。`apps/api/src/modules/notifications/` 目录不存在；schema 中无 notifications / messages / inbox 类表；contracts 无任何通知路由。
- 现有最接近的只有 `site_announcements`（`schema.prisma:136`，站点公告，按 site 维度，非用户级站内信、无已读状态）和 `audit_logs`（审计，非面向用户的通知）。两者都不能当通知用。

### 缺口（要做需要新建什么）

- 新表（至少）：`notifications`（id / siteId / tenantId / userId / type / title / body / readAt / createdAt），按需加分类与关联实体（如 orderId/ticketId）。需要迁移。
- 新模块：notifications controller + use-cases + repository：
  - `GET /notifications`（分页列表，沿用 `PageQueryDto`）。
  - `GET /notifications/unread-count`（未读计数）。
  - `POST /notifications/:id/read` / `POST /notifications/read-all`（标记已读）。
- 产生方：必须明确 source of truth —— 谁写通知（工单回复、订单状态变更、钱包变动、到期提醒等领域事件触发）。这是设计重点，不能只做"空收件箱壳"。

### 安全约束

- 严格按 `userId` + site/tenant 隔离，只能读自己的通知。
- 标记已读需校验归属。

### 工作量评估：**大**

新表 + 迁移 + 新模块（controller/use-case/repository）+ 在各领域事件里挂"产生通知"的写入点。是 4 件里最重的。

### 能否纯前端做：**否（差最多）**

零后端。前端只能做假收件箱，违反"禁止假 UI / 假数据"。必须先建表 + 模块 + 通知产生逻辑。

---

## 4. Provider 健康 / 请求日志

### 4a. Provider 健康

#### 现状

- `providers` 模块**没有 controller**（`providers.module.ts` 只 `providers/exports` 了 `ProviderRegistryService / UpstreamLogRepository / UpstreamApiAdapter`，无 `@Controller`）。它是被 fulfillment 等内部调用的领域服务，不直接对外。
- adapter 有 `healthCheck` 能力，但**只在 `upstream-accounts.controller.ts` 的 `POST /upstream-accounts/:id/test`（:67）被调用**——那是"上游 API 账号（`upstream_api_accounts` 表）"连通测试，**不是 Provider（`provider_accounts` 表）的健康/能力矩阵**。
- `provider_accounts` 表（`schema.prisma:351`）存在（credentialEncrypted/baseUrl/status/timeoutMs/inventorySyncEnabled），但**没有任何 controller 读它、没有 Provider 级健康检查 / 能力矩阵 / 连通测试对外接口**。

#### 缺口

- 若要"Provider 健康面板"：新增 providers controller（或 admin 段）暴露 Provider 列表 + 连通测试 + 能力矩阵，复用 registry 的 `healthCheck`。`provider_accounts` 表已存在，主要是补对外读/测端点（健康结果是否落表另议）。

#### 工作量评估：**中**

表已在，缺整层对外 controller + use-case（providers 当前完全无对外面）。比"工单补端点"重，因为是从零起 controller。

#### 能否纯前端做：**否**

providers 无任何对外路由；upstream-accounts 的 `/test` 是上游账号不是 Provider，语义不能混用。

### 4b. 请求日志（upstream_request_logs）

#### 现状

- 表存在：`upstream_request_logs`（`schema.prisma:336`），字段 `siteId / providerCode / upstreamAccountId / operation / requestId / durationMs / status(SUCCESS|ERROR|TIMEOUT) / errorCode / requestSummary / responseSummary / createdAt`。
- 写入已就绪且**已脱敏**：`UpstreamLogRepository`（`providers/upstream-log.repository.ts`）的 `create` 用 `redactSensitiveSummary` 对 apikey/token/password 等敏感键打 `[REDACTED]`（:34-54），符合 PRD §8/§13.1/§14 的脱敏写入要求。
- **读取接口完全缺失**：`UpstreamLogRepository` 只有 `create`（:62），**没有任何 list/query 方法**；无 controller 读这些日志；contracts 无 `request-logs` 路由。

#### 缺口

- 新增读取端点（admin 侧）：按 site/tenant + providerCode + status + 时间范围分页查 `upstream_request_logs`，复用 `PageQueryDto`。需在 `UpstreamLogRepository` 加查询方法 + 新 controller。

#### 安全约束

- admin only，按 site/tenant 隔离。响应已脱敏（写入时已 redact），读取直接用即可。

#### 工作量评估：**小～中**

表 + 脱敏写入都在，**只缺读端点**（仓库查询方法 + controller）。无需新表、无需迁移。

#### 能否纯前端做：**否**

有数据落库但零读接口，前端无法取数。

---

## 总表：4 件 × {后端就绪度 / 要新建的后端 / 风险}

| 功能 | 后端就绪度 | 要新建的后端 | 是否新表/迁移 | 风险 |
|---|---|---|---|---|
| 1. 管理员工单工作台 | 中（表全、ADMIN_USER 枚举已有，缺 admin 端点） | admin 工单 controller + 2~3 use-case + 租户范围仓库方法 + admin 回复写 ADMIN_USER + 状态流转 | 否 | 低～中：归属校验放开到租户范围时勿越权 |
| 2. 用户自助资料 / 改密 | 低（仅 login/logout/auth.me，无 /users/me、无改密、生产无写 passwordHash） | `GET /users/me` + 改密端点（旧密码校验 + bcrypt 重哈希 + 审计/吊销 session） | 仅改密=否；编辑资料超出 email=是 | 中：改密是安全敏感，必须校验旧密码、合理 cost、统一错误形状 |
| 3. 消息通知 | 无（零表零接口零模块） | 新表 notifications + 迁移 + 新模块（list/unread-count/read）+ 各领域事件产生通知 | 是 | 高：最重；需定义通知 source of truth，否则只能做假收件箱 |
| 4a. Provider 健康 | 低（provider_accounts 表在，但 providers 模块无对外 controller） | providers/admin controller + 健康/连通测试/能力矩阵 use-case | 否（健康是否落表另议） | 中：从零起 controller；勿与 upstream-accounts/test 语义混淆 |
| 4b. 请求日志 | 中（表在、脱敏写入在，缺读接口） | UpstreamLogRepository 加查询方法 + admin 读 controller | 否 | 低：数据与脱敏都已就绪 |

## Caveats / Not Found

- 未深入读 `tickets.repository.ts` 的全部行体与 `app.module.ts` 路由注册全表；admin 工单是否复用 tickets 模块 vs 新建 admin 模块属实现选型，本研究只确认"当前无 admin 工单路由"。
- "编辑资料"的具体可编辑字段范围（除 email 外）需产品确认；当前 `users` 表无 name/phone 等字段。
- Provider 健康"能力矩阵"的数据来源（adapter 静态能力 vs 实时探测）需进一步设计，本研究只确认无对外接口。
- 通知"产生方"的领域事件清单需产品/架构确认，本研究只确认零后端。
