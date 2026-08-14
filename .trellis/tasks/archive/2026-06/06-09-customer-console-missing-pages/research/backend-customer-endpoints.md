# Research: 客户控制台 6 个候选页面的后端 customer 面接口就绪情况

- **Query**: 确认 API Key 管理 / 代理验证工具 / 优惠券 / 实名风控 / 推广邀请 / 反馈工单 这 6 个功能各自是否已有面向 customer (USER token) 的真实后端 HTTP 接口
- **Scope**: internal（apps/api 后端 + packages/contracts 交叉验证）
- **Date**: 2026-06-08

## 背景：路由前缀与鉴权语义（先读懂再看表）

- 全局前缀 `api`：`apps/api/src/common/http/res-static-compat.ts:22` `app.setGlobalPrefix('api', ...)`。所以 controller 上 `@Controller('proxies')` 对外路径是 `/api/proxies`。
- 鉴权装饰器（`apps/api/src/common/auth/guards.ts`）：
  - `@RequireAuth()` = 任何已登录身份（USER / TENANT_ADMIN / PLATFORM_ADMIN / SYSTEM 都能进，controller 内部再按 `ctx.ownerType` 分流）。
  - `@RequireUser()` = **仅 USER（客户）**。这是最干净的"customer 面"标志。
  - `@RequireTenantAdmin()` / `@RequirePlatformAdmin()` / `@RequireOperator()` = admin 面。
- 前端约定（`apps/web/src/shared/api/client.ts`）：customer 用 `userApiRequest`（带 `user_token`），admin 用 `apiRequest`（带 `admin_token`）。返回信封 `{code,msg,data,requestId}`，`code !== 0` 抛 `ApiError`。

apps/api 下现有模块（`apps/api/src/modules/`）：
`admin, api-keys, audit, auth, fulfillment, health, openapi, orders, payments, pricing, providers, proxies, resources, sites, tenants, upstream-accounts, users, wallet`。
**没有 coupons / kyc / referral(invite) / tickets(feedback) 任何模块。**

## Findings — 总表

| # | 功能 | 后端是否就绪 | customer 面路由 (method + path) | 关键 DTO | 备注 |
|---|---|---|---|---|---|
| 1 | API Key 管理 | **部分** | `POST /api/api-keys`（@RequireAuth，use-case 内放行 USER）；`DELETE /api/api-keys/:id`（@RequireAuth） | `CreateApiKeyDto`, `ApiKeyResponseDto` | 只有「签发」+「吊销」。**没有 list / 查看 / 轮换** 接口。客户无法列出自己的 key，只在创建时拿到一次 `plainKey` |
| 2 | 代理验证工具 (HTTP/SOCKS5 检测) | **缺失** | 无 | — | proxies 模块只有 list/get/renew/change-password/switch-ip/export，**没有任何"检测/验证连通性"端点**。"verify" 关键词仅命中内部业务，无 proxy-check API |
| 3 | 优惠券 | **缺失** | 无 | — | 无 coupon 模块。"coupon" 仅出现在上游 provider adapter 的请求字段 (`pr.adapter.ts:275` 写死 `coupon: ''`)，与平台自有优惠券无关 |
| 4 | 实名 / 风控状态 | **缺失（customer 面）** | 无 | — | `kycStatus` / `riskStatus` 只是 DB 字段（`users.repository.ts:12,61`、`integration-setup.ts:138-139`）。`GET /api/auth/me` **不返回** kyc/risk。无任何 customer 查询端点。users 列表是 admin-only |
| 5 | 推广 / 邀请 | **缺失** | 无 | — | 无 referral / invite 模块，无路由，DB / 代码均无相关实体 |
| 6 | 反馈 / 工单 | **缺失** | 无 | — | 无 ticket / feedback 模块，无路由 |

**结论：6 个功能里只有「API Key 管理」有部分后端支撑（且缺关键的列表/轮换），其余 5 个完全没有 customer 面后端。**

## 唯一「部分就绪」功能的可对接细节：API Key 管理

来源：`apps/api/src/modules/api-keys/api-keys.controller.ts`、`dto.ts`、`use-cases/create-api-key.use-case.ts`；契约 `packages/contracts/openapi.json:74-109`。

可直接对接的端点（customer 用 `userApiRequest`）：

- **签发** `POST /api/api-keys`
  - 请求 `CreateApiKeyDto`：`{ name?: string; scopes: string[]; ipWhitelist?: string[]; tenantId: string }`
  - 响应 `ApiKeyResponseDto`：`{ id, keyPrefix, scopes, ipWhitelist, status, createdAt, plainKey? }`
  - `plainKey` **仅在创建响应中返回一次**（明文 key），需提示用户立刻保存。
  - use-case 校验：`ctx.ownerType` 必须是 `USER` 或 `TENANT_ADMIN`，且 `ctx.tenantId === dto.tenantId`，否则 403（`create-api-key.use-case.ts:16-21`）。
- **吊销** `DELETE /api/api-keys/:id`，无响应体（204/200）。

前端做这个页面时能做到的范围：仅"创建新 key（展示一次明文）+ 删除 key"。**无法做"我的 API Key 列表"**，因为没有 GET 列表端点；也**无法做"轮换"**（需先 list 再逐个操作，缺 list 即无法实现）。如果 PRD 要求列表/轮换，则需要先补后端。

## Caveats / Not Found

- **代理验证工具**：proxies 模块（`proxies.controller.ts`）全部端点已列出，无连通性检测/验证类接口。该功能若要做，需新增后端（且可能涉及对外网络探测，属新能力）。
- **优惠券 / 推广邀请 / 反馈工单**：apps/api 下**完全没有对应模块**（无 controller、无 DB 实体引用）。属于"完全没有后端"，前端不应做。
- **实名/风控**：数据层有 `kycStatus` / `riskStatus` 字段，但**没有任何 customer 可调用的查询接口**，且 `/api/auth/me` 的 `CurrentUserDto`（`apps/api/src/modules/auth/dto.ts:12-18`）只含 `ownerId/ownerType/siteId/tenantId/scopes`，不含 kyc/risk。前端无法仅靠现有接口展示客户自己的实名/风控状态。
- 交叉验证：`packages/contracts/openapi.json` 中搜索 `coupon|kyc|referral|ticket|feedback` 路径均**无命中**；api-keys 在契约里也只有 `post /api/api-keys` 与 `delete /api/api-keys/{id}`，无 get，印证缺列表端点。
- 本次仅做静态代码 + 契约审查，未运行服务实测端点行为。
