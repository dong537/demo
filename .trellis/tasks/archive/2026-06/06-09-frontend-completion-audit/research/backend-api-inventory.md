# Research: 后端对外 HTTP 接口穷举与身份分类

- **Query**: 穷举 apps/api 所有对外 HTTP 接口，按面向身份分类，作为前端能力的权威依据
- **Scope**: internal
- **Date**: 2026-06-09

## 约定

- 全局前缀 `api`（`common/http/res-static-compat.ts:22` `app.setGlobalPrefix('api', ...)`）。`@Controller('x')` → `/api/x`。
- 排除前缀的路由：`health`、`ready`，以及 `res_static/*` 的 POST 路由（`exclude` 列表）。因此 OpenAPI 兼容层落在裸 `/res_static/*`，**不带** `/api` 前缀。
- 鉴权装饰器（`common/auth/guards.ts`）：
  - `@RequireAuth()` = 仅校验已登录（JWT Bearer 或 apikey header），**不限角色**；角色分流在 controller/use-case 内按 `ctx.ownerType` 判断。
  - `@RequireUser()` = 强制 `ownerType === 'USER'`（customer 专属）。
  - `@RequireOperator()` = `PLATFORM_ADMIN` 或 `SYSTEM`。
  - `@RequireTenantAdmin()` = `TENANT_ADMIN`。
  - `@RequirePlatformAdmin()` = `PLATFORM_ADMIN`。
  - `@RequireSystem()` = `SYSTEM`。
  - 无装饰器 = **public**（匿名可访问）。
- `ownerType` 取值：`USER`(终端客户) / `TENANT_ADMIN`(租户管理员) / `PLATFORM_ADMIN`(平台管理员) / `SYSTEM`。
- 实测：`@RequireOperator/@RequireTenantAdmin/@RequireSystem` 这三类装饰器在当前 controller 中**未被任何路由使用**；admin 类路由统一用 `@RequireAuth()` + use-case 内 `ownerType` 分流。

---

## Findings

### Files Found

| File Path | 说明 |
|---|---|
| `apps/api/src/common/auth/guards.ts` | 鉴权装饰器与 Guard 实现（角色定义权威来源） |
| `apps/api/src/common/http/res-static-compat.ts` | 全局前缀 + res_static 排除列表 |
| `apps/api/src/modules/*/**.controller.ts` | 各模块控制器 |
| `apps/api/src/modules/openapi/res-static.controller.ts` | OpenAPI 兼容层（裸 `/res_static/*`） |

---

## 完整路由表（按模块分组）

### auth — `apps/api/src/modules/auth/auth.controller.ts`

| method+path | 面向角色 | 关键 DTO | 备注 |
|---|---|---|---|
| POST `/api/auth/login` | **public** | in: `{username/email, password}` (LoginDto) → out: `{token, ...}` (LoginResponseDto) | 唯一无鉴权的登录入口 |
| GET `/api/auth/me` | 全部已登录(USER/TENANT_ADMIN/PLATFORM_ADMIN/SYSTEM) | out: `{ownerId, ownerType, siteId, tenantId, scopes}` | 当前身份自省 |
| POST `/api/auth/logout` | 全部已登录 | — | 注销当前 session |

### users — `apps/api/src/modules/users/users.controller.ts`

| method+path | 面向角色 | 关键 DTO | 备注 |
|---|---|---|---|
| GET `/api/users` | **PLATFORM_ADMIN / TENANT_ADMIN**（USER 被 403） | query: `PageQuery + {status, tenantId}` → `PageResult<AdminUserListItem>` | 管理端用户列表；tenant-admin 限本租户 |

### wallet — `apps/api/src/modules/wallet/wallet.controller.ts`

| method+path | 面向角色 | 关键 DTO | 备注 |
|---|---|---|---|
| GET `/api/wallet/:userId` | USER(本人) / TENANT_ADMIN(本租户) / PLATFORM_ADMIN | out: `WalletDto{available, frozen, currency}` | `access.ts` 内 `getWalletForContext` 校验；USER 只能读自己 |
| GET `/api/wallet/:userId/ledger` | 同上 | query: `PageQuery + {type, from, to}` → `PageResult<LedgerEntryDto>` | 流水 |
| POST `/api/wallet/:userId/adjust` | **PLATFORM_ADMIN / TENANT_ADMIN only** | in: `AdjustWalletDto{amount, currency, reason}` | use-case `admin_only`，USER 不可调账 |

### payments — `apps/api/src/modules/payments/payments.controller.ts`

| method+path | 面向角色 | 关键 DTO | 备注 |
|---|---|---|---|
| POST `/api/payments` | **USER only**（充值下单） | in: `CreatePaymentOrderDto{amount, currency, channel, idempotencyKey}` → `PaymentOrderDto` | use-case `user_only` |
| GET `/api/payments` | USER(本人) / TENANT_ADMIN / PLATFORM_ADMIN | query: `PageQuery + {userId, status, channel}` → `PageResult<PaymentOrderDto>` | USER 强制按自己 ownerId |
| GET `/api/payments/:id` | USER(本人) / TENANT_ADMIN / PLATFORM_ADMIN | → `PaymentOrderDto` | USER 读他人单 403 |
| POST `/api/payments/:id/confirm` | **PLATFORM_ADMIN / TENANT_ADMIN only** | in: `ConfirmPaymentOrderDto` → `{order, wallet}` | 人工确认到账，USER 不可 |

### orders — `apps/api/src/modules/orders/orders.controller.ts`

| method+path | 面向角色 | 关键 DTO | 备注 |
|---|---|---|---|
| POST `/api/orders/static-proxy` | **USER only** | in: `CreateStaticProxyOrderInput{resourceId, quantity, durationDays, currency, idempotencyKey}` | 客户下单买静态代理 |
| POST `/api/orders/users/:userId/static-proxy` | **PLATFORM_ADMIN / TENANT_ADMIN only** | in: `AdminCreateStaticProxyOrderDto` → `CreateStaticProxyOrderResultDto` | 管理员代客下单（admin_only） |
| GET `/api/orders` | USER(本人) / TENANT_ADMIN / PLATFORM_ADMIN | query: `PageQuery + {tenantId, userId, status}` | 各角色分流 |
| POST `/api/orders/:id/retry-fulfillment` | **admin**（PLATFORM/TENANT，use-case 内判定） | in: `AdminOrderOperationDto`(optional) | 重试履约 |
| POST `/api/orders/:id/refund` | **admin** | in: `RequiredAdminOrderOperationDto{reason}` | 退款 |
| POST `/api/orders/:id/manual-complete` | **admin** | in: `RequiredAdminOrderOperationDto{reason}` | 手动完成 |
| GET `/api/orders/:id/fulfillment` | USER(本人) / admin | → 履约明细 | 先校验可读单 |
| GET `/api/orders/:id` | USER(本人) / admin | → order | USER 读他人单 404 |

### proxies — `apps/api/src/modules/proxies/proxies.controller.ts`

| method+path | 面向角色 | 关键 DTO | 备注 |
|---|---|---|---|
| GET `/api/proxies/export` | **USER only** | query: `{format}` → `string[]` | 导出带明文密码的代理行；写审计 |
| GET `/api/proxies` | USER(本人,带明文密码) / TENANT_ADMIN / PLATFORM_ADMIN(脱敏) | query: `ProxyListQuery` | USER 返回交付 DTO，admin 返回脱敏 DTO |
| GET `/api/proxies/:id` | **USER only**(本人) | → 交付 DTO(含明文密码) | |
| POST `/api/proxies/batch-renew` | **USER only** | in: `{proxyIds[], durationDays, idempotencyKey}` | 批量续费 |
| POST `/api/proxies/batch-change-password` | **USER only** | in: `{proxyIds[]}` | 批量改密 |
| POST `/api/proxies/batch-switch-ip` | **USER only** | in: `{proxyIds[]}` | 批量换 IP |
| POST `/api/proxies/:id/renew` | **USER only** | in: `{durationDays, idempotencyKey}` | 单条续费 |
| POST `/api/proxies/:id/change-password` | **USER only** | — | 单条改密 |
| POST `/api/proxies/:id/switch-ip` | **USER only** | — | 单条换 IP |

### proxy-check — `apps/api/src/modules/proxy-check/proxy-check.controller.ts`

| method+path | 面向角色 | 关键 DTO | 备注 |
|---|---|---|---|
| POST `/api/proxy-check` | **USER only**（use-case 内判定） | in: `CheckProxyDto` → `ProxyCheckResultDto` | 代理可用性检测 |

### resources — `apps/api/src/modules/resources/resources.controller.ts`

| method+path | 面向角色 | 关键 DTO | 备注 |
|---|---|---|---|
| GET `/api/resources` | USER(仅 publicOnly) / PLATFORM_ADMIN / TENANT_ADMIN | query: `ResourceListQuery` → `PageResult<ResourceListItem>` | USER 只看可售可见资源 |
| POST `/api/resources` | **admin only** | in: `CreateResourceBody{type, code, name, providerCode, ipType, protocol...}` | 建资源 |
| PUT `/api/resources/:id` | **admin only** | in: `UpdateResourceBody`(partial) | 改资源 |
| GET `/api/resources/:id/inventory` | 全部已登录 | → 最新库存快照 | 库存陈旧返回 422 |
| POST `/api/resources/sync-inventory` | **admin only** | in: `{providerCode}` | 按 provider 同步库存 |
| POST `/api/resources/:id/sync-inventory` | **admin only** | — | 按资源同步库存 |

### pricing — `apps/api/src/modules/pricing/pricing.controller.ts`

| method+path | 面向角色 | 关键 DTO | 备注 |
|---|---|---|---|
| GET `/api/pricing/templates` | **admin only**(PLATFORM/TENANT) | query: `PageQuery` | 价格模板列表 |
| POST `/api/pricing/templates` | **admin only** | in: `{name, description, isDefault}` | 建模板 |
| POST `/api/pricing/templates/:id/rules` | **admin only** | in: `PriceRuleBody | {rules[]}` | 模板规则 |
| POST `/api/pricing/overrides` | **admin only** | in: `PriceOverrideBody` | 资源级价格覆盖 |
| POST `/api/pricing/user-overrides` | **admin only** | in: `UserPriceOverrideBody{tenantId, userId,...}` | 用户级覆盖 |
| POST `/api/pricing/user-template-bindings` | **admin only** | in: `{tenantId, userId, templateId}` | 绑定用户模板 |
| POST `/api/pricing/quote-sandbox` | **admin only** | in: `QuoteSandboxBody` | 管理员试算 |
| GET `/api/pricing/quote` | **USER only**（`@RequireUser`） | query: `{resourceId, durationDays, quantity, currency}` | 客户实时报价 |

### api-keys — `apps/api/src/modules/api-keys/api-keys.controller.ts`

| method+path | 面向角色 | 关键 DTO | 备注 |
|---|---|---|---|
| GET `/api/api-keys` | **USER / TENANT_ADMIN**（use-case 判定，PLATFORM/SYSTEM 被 403） | query: `PageQuery` → `PageResult<ApiKeyListItemDto>` | |
| POST `/api/api-keys` | **USER / TENANT_ADMIN** | in: `CreateApiKeyDto{name, scopes, ipWhitelist?, expiresAt?}` → `ApiKeyResponseDto`(含明文 key) | |
| DELETE `/api/api-keys/:id` | USER(本人) / TENANT_ADMIN / **也允许 PLATFORM_ADMIN** | — | revoke use-case 含 `isPlatformAdmin` 分支 |

### tickets — `apps/api/src/modules/tickets/tickets.controller.ts`

| method+path | 面向角色 | 关键 DTO | 备注 |
|---|---|---|---|
| GET `/api/tickets` | **USER only**（`access.ts` requireTicketOwner，非 USER 403） | query: `PageQuery` → `PageResult<TicketListItemDto>` | 工单是纯 customer surface |
| POST `/api/tickets` | **USER only** | in: `CreateTicketDto{subject, content, ...}` → `TicketDetailDto` | |
| GET `/api/tickets/:id` | **USER only** | → `TicketDetailDto` | |
| POST `/api/tickets/:id/messages` | **USER only** | in: `ReplyTicketDto{content}` | 追加回复 |
| POST `/api/tickets/:id/close` | **USER only** | — | 关闭工单 |

> 注意：当前工单**没有管理员侧回复/处理接口**，admin 无法在后端回复工单（见汇总缺口）。

### tenants — `apps/api/src/modules/tenants/tenants.controller.ts`

| method+path | 面向角色 | 关键 DTO | 备注 |
|---|---|---|---|
| GET `/api/tenants` | PLATFORM_ADMIN(全部) / TENANT_ADMIN(仅本租户单条) | query: `PageQuery` → `TenantPageDto` | |
| POST `/api/tenants` | **PLATFORM_ADMIN only** | in: `CreateTenantDto{code, name}` → `TenantListItemDto` | |
| GET `/api/tenants/:id` | PLATFORM_ADMIN / TENANT_ADMIN(本租户) | → `TenantDetailDto` + stats | |
| PUT `/api/tenants/:id/status` | **PLATFORM_ADMIN only** | in: `UpdateTenantStatusDto{status: ACTIVE|SUSPENDED}` | |

### tenants/brand — `apps/api/src/modules/tenants/tenant-brand.controller.ts`

| method+path | 面向角色 | 关键 DTO | 备注 |
|---|---|---|---|
| GET `/api/tenants/:id/brand` | **public**（无装饰器） | → `TenantBrandDto{siteName, logoUrl, primaryColor, customDomain, supportEmail}` | 匿名读品牌（前台白标渲染） |
| PUT `/api/tenants/:id/brand` | **admin only**(PLATFORM/TENANT 本租户) | in: `UpdateTenantBrandConfigDto` | 写品牌配置 |

### tenants/provider-accounts — `apps/api/src/modules/tenants/tenant-provider-accounts.controller.ts`

| method+path | 面向角色 | 关键 DTO | 备注 |
|---|---|---|---|
| GET `/api/tenants/:tenantId/provider-accounts` | **admin only**(PLATFORM/TENANT 本租户) | → `[TenantProviderAccountDto]` | |
| POST `/api/tenants/:tenantId/provider-accounts` | **admin only** | in: `CreateTenantProviderAccountDto{providerCode(IPIPD/985/PR), baseUrl, credential, timeoutMs?, inventorySyncEnabled?}` | 凭据加密存储 |
| PUT `/api/tenants/:tenantId/provider-accounts/:accountId` | **admin only** | in: `UpdateTenantProviderAccountDto` | |
| DELETE `/api/tenants/:tenantId/provider-accounts/:accountId` | **admin only** | — | 禁用 |

### upstream-accounts — `apps/api/src/modules/upstream-accounts/upstream-accounts.controller.ts`

| method+path | 面向角色 | 关键 DTO | 备注 |
|---|---|---|---|
| GET `/api/upstream-accounts` | PLATFORM_ADMIN / TENANT_ADMIN | → 账号列表（tenant 看本租户+public） | |
| POST `/api/upstream-accounts` | **admin only** | in: `{name, baseUrl, apiKey, timeoutMs?, inventorySyncEnabled?}` | UPSTREAM_API 类上游 |
| POST `/api/upstream-accounts/:id/test` | **admin**(use-case 判定) | → healthCheck 结果 | |
| POST `/api/upstream-accounts/:id/sync-inventory` | **admin only** | → `{synced, syncedAt}` | |
| DELETE `/api/upstream-accounts/:id` | **admin only** | — | 禁用 |

### audit — `apps/api/src/modules/audit/audit.controller.ts`

| method+path | 面向角色 | 关键 DTO | 备注 |
|---|---|---|---|
| GET `/api/audit` | **PLATFORM_ADMIN / TENANT_ADMIN**（USER 403） | query: `PageQuery + {action, actorType}` → `PageResult<AuditLogListItem>` | tenant 限本租户 |

### sites — `apps/api/src/modules/sites/sites.controller.ts`

| method+path | 面向角色 | 关键 DTO | 备注 |
|---|---|---|---|
| GET `/api/sites/current` | **public** | → `{site, announcements}` | 按 host/默认站点解析；前台站点信息 |
| PUT `/api/sites/current/brand` | **PLATFORM_ADMIN only** | in: brand config | |
| GET `/api/sites/current/announcements` | **public** | → announcements | |
| POST `/api/sites/current/announcements` | **PLATFORM_ADMIN only** | in: `{title, content, startsAt?, endsAt?}` | |
| PUT `/api/sites/current/announcements/:id` | **PLATFORM_ADMIN only** | in: partial | |
| DELETE `/api/sites/current/announcements/:id` | **PLATFORM_ADMIN only** | — | 下架公告 |

### health — `apps/api/src/modules/health/health.controller.ts`

| method+path | 面向角色 | 备注 |
|---|---|---|
| GET `/health` | **public**（无 `/api` 前缀） | liveness |
| GET `/ready` | **public**（无 `/api` 前缀） | readiness：db + redis |

### openapi 兼容层 (res_static) — `apps/api/src/modules/openapi/res-static.controller.ts`

> 全部 `@RequireUser()`（**USER only**），POST，裸路径 `/res_static/*`（**不带 `/api` 前缀**，因 exclude）。这是给客户用 apikey 调用的 OpenAPI 形态，等价于 customer 面能力的另一套入口（snake_case envelope）。

| method+path | 关键 DTO | 等价能力 |
|---|---|---|
| POST `/res_static/business` | `BusinessListDto` | 可售资源列表 |
| POST `/res_static/inventory` | `InventoryQueryDto{resource_id?}` | 库存查询 |
| POST `/res_static/calculate` | `CalculateDto{resource_id, duration_days, quantity, currency}` | 报价 |
| POST `/res_static/buy` | `BuyDto{... idempotency_key}` | 下单 |
| POST `/res_static/renew` | `RenewDto{proxy_id, duration_days, idempotency_key}` | 续费 |
| POST `/res_static/order_result` | `OrderResultDto{order_no}` | 订单结果+代理列表 |
| POST `/res_static/order_list` | `OrderListDto{page, page_size, status}` | 订单列表 |
| POST `/res_static/ip_list` | `IpListDto{...filters}` | 代理列表 |
| POST `/res_static/ip_export` | `IpExportDto{format,...}` | 导出（**注意：此路由不在 exclude 列表中 → 实际带前缀 `/api/res_static/ip_export`**） |
| POST `/res_static/ip_detail` | `IpDetailDto{proxy_id}` | 代理详情 |
| POST `/res_static/change_auth` | `ChangeAuthDto{proxy_id}` | 改密 |
| POST `/res_static/switch_ip_list` | `SwitchIpListDto` | 可换 IP 列表 |
| POST `/res_static/switch_ip` | `SwitchIpDto{proxy_id}` | 换 IP |
| POST `/res_static/wallet/balance` | — | 余额 |
| POST `/res_static/wallet/records` | `WalletRecordsDto{page, page_size}` | 钱包流水 |

---

## 汇总：按业务域的后端完备度

接口总量级：**约 60 条对外路由**（19 个 controller，含 res_static 兼容层 15 条）。

### A. 后端齐全、可支撑完整前端

| 业务域 | 评估 |
|---|---|
| 认证/会话 | login + me + logout 闭环 |
| 钱包/账务 | 查询、流水、调账（admin）、客户充值下单+admin 确认闭环 |
| 订单 | 客户下单、列表、详情、履约查看 + admin 代下单/退款/重试/手动完成 |
| 代理实例生命周期 | 列表/详情/导出/续费/改密/换 IP（单条+批量）齐全 |
| 资源/库存 | admin CRUD + 同步，USER 只读可售资源 |
| 定价 | admin 模板/规则/覆盖/绑定/试算 + USER 实时报价 |
| API Key | USER/TENANT_ADMIN 增删查闭环 |
| 租户管理 | 列表/详情/建/改状态 + 品牌 + provider-accounts CRUD |
| 上游账号 | CRUD + 测试 + 同步 |
| 站点/公告 | 前台只读 + admin 管理 |
| OpenAPI 兼容 | customer 全套 snake_case 入口 |

### B. 仅有部分接口（前端会缺动作）

| 业务域 | 缺口 |
|---|---|
| **工单 tickets** | 只有 **USER 侧**（建/列/详情/回复/关闭）；**没有 admin 侧**列表/回复/处理接口。后台无法处理工单。 |
| **审计 audit** | 只有列表查询，无导出、无详情、无按 targetId 过滤的专用接口。 |
| **用户管理 users** | 只有 admin 列表（GET），**无创建/改状态/改密/详情**接口。USER 自身资料无 self-service 接口（无 `/users/me` 资料编辑）。 |
| **支付渠道** | 只有下单+人工确认，无渠道配置/回调 webhook 对外路由（可能在别处或未实现）。 |

### C. 完全没有后端模块的域（前端若要做需先补后端）

- **用户自助资料/改密/安全设置**（profile / change-own-password / 2FA）——无对应 controller。
- **管理员侧工单工作台**——无 controller。
- **仪表盘/统计聚合接口**（dashboard KPI）——除 `tenants/:id` 内嵌 stats 外，无独立 metrics/overview 接口。
- **通知/消息中心**——无模块。
- **admin 用户（管理员账号）管理**——`modules/admin/` 下只有 `tests/`，无 controller/module 实体。

---

## customer(USER) 面可用接口清单（前端用户端能做什么）

REST（带 `/api` 前缀）：

1. `POST /api/auth/login`、`GET /api/auth/me`、`POST /api/auth/logout` — 登录态
2. `GET /api/wallet/:userId`、`/ledger` — 看余额与流水（仅本人）
3. `POST /api/payments` — 发起充值下单；`GET /api/payments`、`/api/payments/:id` — 看自己充值单
4. `GET /api/pricing/quote` — 实时报价
5. `GET /api/resources` — 浏览可售资源（publicOnly）；`GET /api/resources/:id/inventory` — 库存
6. `POST /api/orders/static-proxy` — 下单买代理；`GET /api/orders`、`/api/orders/:id`、`/api/orders/:id/fulfillment` — 看自己的订单/履约
7. 代理管理全套：`GET /api/proxies`、`/api/proxies/:id`、`/api/proxies/export`，`POST .../renew|change-password|switch-ip`（单条），`POST /api/proxies/batch-renew|batch-change-password|batch-switch-ip`（批量）
8. `POST /api/proxy-check` — 代理检测
9. API Key：`GET/POST /api/api-keys`、`DELETE /api/api-keys/:id`
10. 工单全套：`GET/POST /api/tickets`、`GET /api/tickets/:id`、`POST /api/tickets/:id/messages`、`POST /api/tickets/:id/close`
11. 公开页：`GET /api/sites/current`、`/api/sites/current/announcements`、`GET /api/tenants/:id/brand`（白标渲染，匿名可读）

OpenAPI 兼容（apikey 调用，裸 `/res_static/*`）：business/inventory/calculate/buy/renew/order_result/order_list/ip_list/ip_export/ip_detail/change_auth/switch_ip_list/switch_ip/wallet.balance/wallet.records —— 与上述 REST 客户能力等价的第二套入口。

**customer 面覆盖的业务域**：登录态、钱包余额/流水、充值下单、资源浏览与报价、买代理下单、代理生命周期管理（续费/改密/换 IP/导出/检测，单条+批量）、订单查看、API Key、工单、站点/品牌只读。

**customer 面明显缺口**：无用户自助资料编辑/改登录密码/安全设置接口；无消息通知中心；无独立用户仪表盘聚合接口。

---

## Caveats / Not Found

- `@RequireOperator / @RequireTenantAdmin / @RequireSystem` 三个装饰器已定义但当前 controller 未使用；admin 路由统一走 `@RequireAuth` + use-case 内 `ctx.ownerType` 分流，前端判断权限时需注意"已登录即过 guard，角色错误返回 403"而非 401。
- `modules/admin/` 仅含 `tests/`，无实际 controller/module —— 管理员账号自身的 CRUD 在后端不存在。
- `res_static/ip_export` 未列入 `RES_STATIC_ROUTE_PATHS` exclude 列表，因此它会被加上 `/api` 前缀，实际路径为 `/api/res_static/ip_export`，与其余 `res_static/*` 裸路径不一致（疑似遗漏，仅作事实记录，不评判）。
- DTO 字段形状以 controller 签名与就近类型为准，未逐一展开 `dto.ts` 全部字段；如前端需要精确字段，应直接读对应模块 `dto.ts` 或 `packages/contracts`。
- 未核对 `packages/contracts/openapi.json` 与实际 controller 是否完全一致（contract 可能滞后），需要时另行 diff。
