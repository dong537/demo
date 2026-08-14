# Task 18 实现说明：Reseller 管理 UI

## 目标与不做

- 目标：在 admin 前端补齐 PLATFORM_ADMIN 的 Reseller 管理入口，以及 TENANT_ADMIN 的租户概览和品牌配置入口。
- Reseller 在当前系统中对应既有 `tenants` 领域对象；本任务不新建第二套 reseller 表、DTO 或后端领域。
- 不做：不引入新的请求客户端栈、不重写现有 admin 框架、不做旧字段兼容层、不使用 mock 数据。

## Source of Truth

- 租户/Reseller 基础信息、状态、统计：`apps/api/src/modules/tenants`，HTTP `GET/POST /api/tenants`、`GET /api/tenants/:id`。
- 租户品牌配置：`apps/api/src/modules/tenants/tenant-brand.controller.ts`，HTTP `GET/PUT /api/tenants/:id/brand`。
- 用户列表：`apps/api/src/modules/users`，本任务补 `tenantId` 查询参数给 PLATFORM_ADMIN 使用；TENANT_ADMIN 仍只能读取自身 tenant。
- 订单列表：`apps/api/src/modules/orders`，本任务把 `GET /api/orders` 扩展为 `RequireAuth`，按 `ownerType` 分流：
  - USER 只能读取自己的订单；
  - TENANT_ADMIN 只能读取自身 tenant 订单；
  - PLATFORM_ADMIN 可按 `tenantId` 过滤或读取全站订单。
- 前端会话与角色：`admin_token` 是不透明 session token，不从前端解析；角色与 `tenantId` 以 `GET /api/auth/me` 为权威来源，新增共享 `useCurrentAdmin` hook，避免页面重复手写失效的 `atob`。

## 模块边界

- 后端 controller 只做鉴权分流和 query 归一化；查询条件集中在 repository。
- 前端页面 route 只负责取 URL 参数并渲染 feature。
- `features/admin-tenants` 继续承载租户/Reseller 列表、详情、创建、品牌、租户概览等业务 UI。
- `routes/admin/_layout.tsx` 只负责导航和角色可见性，不承载业务查询。

## 接口契约

- `GET /api/users?page&pageSize&status&search&tenantId`
  - PLATFORM_ADMIN：`tenantId` 可选，存在时过滤指定租户。
  - TENANT_ADMIN：忽略外部 `tenantId`，强制使用 `ctx.tenantId`。
  - 响应沿用统一 envelope 内的 `PageResult`。
- `GET /api/orders?page&pageSize&status&tenantId&userId`
  - USER：忽略管理侧过滤参数，返回当前用户订单。
  - TENANT_ADMIN：tenant 固定为 `ctx.tenantId`，可按 `userId/status` 过滤。
  - PLATFORM_ADMIN：可按 `tenantId/userId/status` 过滤。
- 品牌保存失败、权限失败、网络失败必须在 UI 中可见，不返回空状态伪装成功。

## 前端数据流

admin_token -> `GET /api/auth/me` -> role hook -> layout menu/route feature -> `shared/api/client.ts` -> API envelope -> feature local server state -> Ant Design table/form。

说明：PRD 提到 openapi-ts client，但当前 admin 前端权威请求层是 `shared/api/client.ts`，现有页面和错误处理都依赖它。本任务沿用现有请求层，避免混用两套 API 访问路径。

## 风险与验证

- 风险：现有 `/api/orders` 只有用户态权限，admin 订单列表会失败；本任务补后端契约并加集成测试。
- 注意：中文 i18n 文件是 UTF-8；PowerShell 默认读取可能显示乱码，检查时使用 `Get-Content -Encoding UTF8`。
- 验证：
  - API：新增/更新 users tenant 过滤、orders admin 列表测试。
  - Web：运行 typecheck/lint/test，覆盖新增 feature 的关键渲染和 API 参数。
  - 构建：运行 web build，确认 TanStack Router 路由注册无冲突。

## 实施记录

- 后端：
  - `GET /api/users` 支持 PLATFORM_ADMIN 传 `tenantId` 过滤；TENANT_ADMIN 强制使用自身 tenant context。
  - `GET /api/orders` 改为 `RequireAuth`，按 USER/TENANT_ADMIN/PLATFORM_ADMIN 分流。
  - 新增 `/api/orders/:id/fulfillment`，先复用订单访问检查，再读取履约投影。
- 前端：
  - 新增 `/admin/resellers`、`/admin/resellers/new`、`/admin/resellers/:id`、`/admin/resellers/:id/brand`。
  - 新增 `/admin/dashboard` 和 `/admin/brand`，供 TENANT_ADMIN 使用。
  - 角色来源改为 `/api/auth/me`，不再解析不透明 `admin_token`。
  - 租户/Reseller 详情页新增概览、用户、订单、品牌配置 tabs。
- Spec：
  - `.trellis/spec/frontend/state-management.md` 记录 admin role/tenant context 契约。

## 检查结果

- 通过：`pnpm --filter @ipeasy/api typecheck`
- 通过：`pnpm --filter @ipeasy/api lint`
- 通过：`pnpm --filter @ipeasy/api test`
- 通过：`pnpm --filter @ipeasy/web typecheck`
- 通过：`pnpm --filter @ipeasy/web lint`
- 通过：`pnpm --filter @ipeasy/web test`
- 通过：`pnpm --filter @ipeasy/web build`
- 未通过（环境问题）：`pnpm --filter @ipeasy/api test:integration -- src/modules/admin/tests/admin-min-pages-integration.spec.ts`
  - 原因：当前连接的数据库缺少既有 schema 字段 `tenants.brandConfig`，`seedTenant` 在 beforeEach 失败；需要先迁移/刷新测试库后再跑 integration。
