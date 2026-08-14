# Task 14: Admin 资源编排 UI + 代理管理页

## 目标

让 Admin 与 Customer 的代理资源相关页面从“入口存在”变成真实可用链路：

- PLATFORM_ADMIN 能查看资源、库存、价格模板、订单、代理实例。
- TENANT_ADMIN 能查看自身租户范围内的用户、订单、代理实例。
- USER 能进入代理列表、购买静态代理、查看并复制交付信息。

## 明确不做

- 不做新的供应商适配器。
- 不重写价格域模型。
- 不造 mock 资源、mock 库存、mock 代理交付。
- 不在前端解析不透明 session token。

## Source of Truth

- 当前登录用户：`GET /api/auth/me`，前端通过 `useCurrentCustomer()` / `useCurrentAdmin()` 获取 `ownerId`、`ownerType`、`tenantId`。
- 资源：`GET /api/resources`。USER 只读公开可售资源；Admin 按 site 读取资源。
- 报价：`GET /api/pricing/quote?resourceId&durationDays&quantity&currency`。
- 下单：`POST /api/orders/static-proxy`，body 为 `resourceId`、`durationDays`、`quantity`、`currency`、`idempotencyKey`。
- 代理实例：`GET /api/proxies`。本任务将其扩展为按 ownerType 分流：
  - USER：只能读自己的代理，返回解密后的交付密码。
  - TENANT_ADMIN：只能读自身 tenant 代理，不返回密码。
  - PLATFORM_ADMIN：按 site 读取，可选 `tenantId/userId/status/countryCode` 过滤，不返回密码。

## 模块边界

- 后端 controller：只做鉴权分流和 query 归一化。
- 后端 repository：集中 Prisma where 条件、分页和排序。
- Customer 页面：通过 `useCurrentCustomer()` 拿 userId/currency，不解析 `user_token`。
- Admin 页面：复用统一 ListPage，后端权限失败必须显示错误，不用空表伪装。

## 接口契约

### GET /api/proxies

Query:

- `page?: number`
- `pageSize?: number`
- `status?: ProxyStatus`
- `countryCode?: string`
- `tenantId?: string`，PLATFORM_ADMIN 可用
- `userId?: string`，PLATFORM_ADMIN/TENANT_ADMIN 可用

Response:

- `PageResult<ProxyDto>`
- USER 响应包含 `username/password` 用于复制交付信息。
- Admin 响应不包含 `password`。

### Customer buy flow

1. `GET /api/auth/me` 获取 `ownerId`。
2. `GET /api/wallet/:ownerId` 获取 `currency/available`。
3. `GET /api/resources?pageSize=200` 获取可售资源，选项 value 使用 `resource.id`。
4. `GET /api/pricing/quote` 使用 `resourceId/durationDays/quantity/currency`。
5. `POST /api/orders/static-proxy` 使用同一组字段加 `idempotencyKey`。
6. 下单成功后，如果后端尚未同步返回代理实例，显示订单状态并引导去订单/代理列表，不假装已有代理。

## 当前缺口

- Customer `/buy`、`/proxies` route 文件存在，但未注册到 router/customer menu。
- Customer 代理列表调用 `/api/proxies/mine`，后端没有该路由。
- Admin 代理列表调用 `/api/proxies`，但后端当前 `@RequireUser()`，admin 必定 403。
- 购买页用 `decodeUserToken()` 解析 `user_token`，但 token 是不透明 session。
- 购买页 quote 参数仍是 `resourceCode/duration`，与后端 `resourceId/durationDays/currency` 不一致。

## 实现记录

- `GET /api/proxies` 改为 `RequireAuth` 后按 `ownerType` 分流：USER 返回本人代理与解密交付密码；TENANT_ADMIN 返回当前租户代理脱敏列表；PLATFORM_ADMIN 返回当前 site 内代理脱敏列表并支持 `tenantId/userId/status/countryCode/search` 过滤。
- 代理 repository 增加 site 约束，避免同 tenant/user 在不同 site 下串读；OpenAPI 静态代理列表/切 IP 列表同步使用新的 site-aware 查询签名。
- Admin 资源页补齐真实创建/编辑表单，走 `POST /api/resources` 与 `PUT /api/resources/:id`；资源状态过滤改为后端真实枚举 `ACTIVE/HIDDEN/DISABLED`。
- Customer router/menu 注册 `/buy` 与 `/proxies`，代理列表改用真实 `/api/proxies`。
- 购买页删除不透明 token 解析，改由 `/api/auth/me` 获取当前用户，钱包、报价、下单字段与后端 `resourceId/durationDays/quantity/currency/idempotencyKey` 契约对齐。
- 下单成功后只展示订单状态和跳转代理列表入口，不假设 worker 已经立即交付代理实例。
- Admin 价格规则弹窗改为读取真实 `/api/resources`，提交 `resourceId/durationDays/unitPrice/currency/minQty`，不再提交后端已不接受的 `resourceCode/duration`。
- Admin 价格模板列表增加规则明细列，展示实际资源、时长、单价、币种与最小数量，便于配置后直接核对。
- 删除误导性的 `shared/auth/user-token.ts`，避免后续继续解析 session token。

## 验证

- `pnpm --filter @ipeasy/api typecheck`
- `pnpm --filter @ipeasy/api lint`
- `pnpm --filter @ipeasy/api test`：15 files / 61 tests passed，新增 controller 单测覆盖 USER/TENANT_ADMIN/PLATFORM_ADMIN 代理列表分流与 admin 脱敏。
- `pnpm --filter @ipeasy/api build`
- `pnpm --filter @ipeasy/web typecheck`
- `pnpm --filter @ipeasy/web lint`
- `pnpm --filter @ipeasy/web test`：8 files / 22 tests passed，新增 customer flow 测试覆盖 `/api/proxies`、报价 query、下单 body；新增 resource/pricing 测试覆盖资源表单与价格规则请求体。
- `pnpm --filter @ipeasy/web test -- resource-tree.feature.spec.ts price-template.feature.spec.ts customer-proxy-flow.spec.tsx`：3 files / 5 tests passed，用于最后一次资源页小改后的定向回归。
- `pnpm --filter @ipeasy/web build`：通过；Vite 仍提示单 chunk 超过 500 kB，这是既有打包优化提醒。

## 风险

- 当前本机 integration 数据库缺少 `tenants.brandConfig`，integration 需要先迁移/刷新测试库。
- 真实代理交付由 worker 异步完成，购买成功不能假设立即有 `proxies` 数组。
