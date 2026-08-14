# Research: apps/web 前端已实现页面/功能盘点（完成度基线）

- **Query**: 盘点 apps/web 已实现的所有页面/功能，作为"还缺什么"的基线
- **Scope**: internal
- **Date**: 2026-06-09

## 方法与口径

- 路由 source of truth：`apps/web/src/app/router.tsx`（集中式 TanStack Router，非文件路由）。
- 路由 page 文件多为薄 wrapper（`routes/**/index.tsx` 直接渲染对应 feature），业务在 `features/**/*.feature.tsx`。
- 完成度判定：
  - **完整** = 真实连后端 + 列表/详情/操作/状态闭环。
  - **部分** = 连后端但只列表无详情、缺操作、或缺关键 PRD 能力。
  - **壳** = 仅展示/占位，无实质后端闭环。
- 角色门控来自 `router.tsx` 的 `requireAdminRole([...])` 与 `_layout.tsx` 菜单（platform vs tenant）。
- 注：ripgrep 在 Windows 下显示 `\api\...` 是渲染假象，实际源码均为正斜杠 `/api/...`，无路径 bug。

---

## Admin 端已覆盖（路由集中在 `/admin/*`）

| 路由 | feature | 调用端点 | 完成度 | 角色可见性 |
|---|---|---|---|---|
| `/admin/login` | `auth/admin-login.feature` | `GET /api/sites/current`, `POST /api/auth/login` | 完整 | 公开 |
| `/admin/`（index） | 重定向 | `GET /api/auth/me` → tenant 去 `/dashboard`，platform 去 `/resellers` | 完整 | 登录后 |
| `/admin/dashboard` | `admin-tenants/tenant-dashboard.feature` | `GET /api/tenants/:id` | 部分（仅 3 个 Statistic 卡：客户数/总余额/月订单，无趋势/drilldown） | 仅 TENANT_ADMIN |
| `/admin/brand` | `admin-tenants/tenant-brand.feature` | `GET/PUT /api/tenants/:id/brand` | 完整（品牌表单） | 仅 TENANT_ADMIN |
| `/admin/users` | `admin-users/user-list.feature`（+`admin-customer-order-drawer`） | `GET /api/users`（分页/search/status/tenantId）；代客下单 drawer：`GET /api/resources`、`GET /api/wallet/:id`、`POST` 代客静态代理单 | 完整（列表+筛选+代客下单 drawer） | 两类 admin |
| `/admin/wallet` | `wallet/ledger-list.feature` | `GET /api/wallet/:userId/ledger`（分页/type/from/to） | 部分（账本流水列表；调账/充值/扣款入口在此页未见，需按 userId 查询） | 两类 admin |
| `/admin/payments` | `wallet/payment-list.feature` | `GET /api/payments`（分页/status/channel）, `POST /api/payments/:id/confirm` | 完整（支付单列表+人工确认） | 两类 admin |
| `/admin/audit` | `audit/audit-log-list.feature` | `GET /api/audit`（分页/action/actorType/from/to） | 完整（审计日志列表+筛选） | 两类 admin |
| `/admin/orders` | `admin-orders/order-list.feature`（+`fulfillment-detail`、`admin-order-operations`） | `GET /api/orders`（分页/status/tenant/user）, `GET /api/orders/:id/fulfillment`, `POST /api/orders/:id/{retry-fulfillment\|refund\|manual-complete}` | 完整（列表+履约详情+重试/退款/手动完成操作） | 两类 admin |
| `/admin/proxies` | `admin-proxies/proxy-list.feature` | `GET /api/proxies`（分页/status） | 部分（只读列表，无生命周期操作/详情/续费/切IP） | 两类 admin |
| `/admin/tenants` | `admin-tenants/tenant-list.feature` | `GET /api/tenants`, `PUT /api/tenants/:id/status`（suspend） | 完整（列表+停用） | 两类 admin（menu 未直接暴露，详见下） |
| `/admin/tenants/new` | `admin-tenants/tenant-create.feature` | `POST /api/tenants` | 完整 | 仅 PLATFORM_ADMIN |
| `/admin/tenants/:id` | `admin-tenants/tenant-detail.feature` | `GET /api/tenants/:id`, `PUT .../status`；Tabs 内嵌 users/orders/brand | 完整（概览+用户+订单+品牌 tab+停用） | 两类 admin |
| `/admin/tenants/:id/brand` | `admin-tenants/tenant-brand.feature` | `GET/PUT /api/tenants/:id/brand` | 完整 | 两类 admin |
| `/admin/resellers` | `admin-tenants/tenant-list.feature mode=reseller` | `GET /api/tenants` | 完整（复用 tenant-list，分站口径） | 仅 PLATFORM_ADMIN |
| `/admin/resellers/new` | `admin-tenants/tenant-create.feature` | `POST /api/tenants` | 完整 | 仅 PLATFORM_ADMIN |
| `/admin/resellers/:id` | `admin-tenants/tenant-detail.feature` | 同 tenant-detail | 完整 | 仅 PLATFORM_ADMIN |
| `/admin/resellers/:id/brand` | `admin-tenants/tenant-brand.feature` | `GET/PUT /api/tenants/:id/brand` | 完整 | 仅 PLATFORM_ADMIN |
| `/admin/resources` | `admin-resources/resource-tree.feature`（+`inventory-panel`） | `GET /api/resources`（分页/search/status）, `POST /api/resources/:id/sync-inventory`, `POST/PUT /api/resources`, `GET /api/resources/:id/inventory` | 完整（资源列表+增改+库存同步+库存快照面板） | 仅 PLATFORM_ADMIN |
| `/admin/pricing` | `pricing/price-template.feature` | `GET /api/pricing/templates`, `GET /api/resources`, `POST /api/pricing/templates`, `POST /api/pricing/templates/:id/rules` | 部分（价格模板+规则创建；缺优惠券/折扣窗口/报价沙盒/用户覆盖价/价格变更审计） | 仅 PLATFORM_ADMIN |
| `/admin/upstream` | `admin-upstream/upstream-list.feature` | `GET /api/upstream-accounts`, `POST /api/upstream-accounts`, `POST .../:id/test`, `POST .../:id/sync-inventory`, `PUT .../:id/status`（disable） | 完整（上游账号列表+创建+连接测试+库存同步+禁用） | 仅 PLATFORM_ADMIN |
| `/admin/site` | `admin-site/site-config.feature` | `GET /api/sites/current`, `PUT .../brand`, `PUT .../maintenance`, `POST .../announcements`, `POST .../announcements/:id/deactivate` | 完整（品牌+维护模式+公告管理） | 仅 PLATFORM_ADMIN |

### Admin 菜单暴露（`routes/admin/_layout.tsx`）

- **TENANT_ADMIN（代理商租户）菜单**：dashboard、brand、users、wallet、payments、audit、orders、proxies。
- **PLATFORM_ADMIN（主站/分站平台）菜单**：resellers、users、wallet、payments、audit、resources、pricing、orders、proxies、upstream、site。
- **菜单未暴露但路由可达**：`/admin/tenants`（tenant 列表，仅 detail 复用）、`/admin/tenants/new`、各 detail/brand 子路由——platform 端通过 resellers 入口进入；tenants 列表本身没有顶层菜单项。

---

## Customer 端已覆盖（路由 `/login` + `customer-layout` 下子路由）

| 路由 | feature | 调用端点 | 完成度 | 备注 |
|---|---|---|---|---|
| `/login` | `auth/customer-login.feature` | `GET /api/sites/current`, `POST /api/auth/login` | 完整 | 公开 |
| `/overview` | `wallet/customer-wallet-overview.feature` | `GET /api/wallet/:userId` | 部分（仅余额/冻结/币种 + 充值按钮；PRD 要求的近期订单/即将过期/代理数量/API Key 状态/动态能力均缺） | 概览页 |
| `/buy` | `customer-proxies/buy-static-proxy.feature` | `GET /api/resources?pageSize=200`, `GET /api/wallet/:id`, `GET 静态代理报价`, `POST /api/orders/static-proxy` | 完整（资源选择+报价+下单） | 静态代理购买 |
| `/proxies` | `customer-proxies/proxy-list.feature` | `GET /api/proxies`（分页/status/country/search）, `POST 生命周期 :id/action`, `POST 批量生命周期`, `GET 导出` | 完整（列表+筛选+单个/批量续费等生命周期+导出） | 我的静态代理 |
| `/api-keys` | `customer-api-keys/api-key-list.feature` | `GET /api/api-keys`（分页）, `POST /api/api-keys`, `DELETE 撤销 :id` | 完整（签发一次性展示+列表+撤销） | API Key 管理 |
| `/proxy-check` | `customer-proxy-check/proxy-check.feature` | `GET /api/proxies`（选代理）, `POST /api/proxy-check` | 完整（选代理+连通性检测） | 代理验证工具 |
| `/tickets` | `customer-tickets/ticket-list.feature` | `GET /api/tickets`（分页）, `POST /api/tickets` | 完整（列表+新建） | 工单 |
| `/tickets/:ticketId` | `customer-tickets/ticket-detail.feature` | `GET /api/tickets/:id`, `POST .../reply`, `POST .../close` | 完整（详情+回复+关闭） | 工单详情 |
| `/wallet` | `wallet/customer-ledger-list.feature` | `GET /api/wallet/:userId/ledger`（分页/type/from/to） | 完整（账单/钱包流水列表+筛选） | 账单和钱包流水 |
| `/wallet/topup` | `wallet/create-payment-order.feature` | `GET /api/wallet/:id`, `POST /api/payments` | 完整（创建充值支付单） | 充值/虚拟余额 |

### Customer 菜单暴露（`routes/customer/_layout.tsx`）

overview、buy、proxies、api-keys、proxy-check、tickets、wallet、wallet/topup。`/tickets/:ticketId` 为列表点入的子路由（不在菜单）。

---

## Public 端

| 路由 | feature | 调用端点 | 完成度 | 备注 |
|---|---|---|---|---|
| `/` | `routes/public/home.tsx`（+`home.css`） | `GET /api/sites/current`（品牌/公开国家列表 envelope） | 完整（landing：品牌、公开国家清单、登录入口；2026-06-09 production-homepage-clone 任务产物） | 官网首页 |

---

## 汇总：对照 PRD 缺口

### Admin 端（PRD §13，共 6 子节）

| PRD §13 子节 | 已有页面 | 缺口 |
|---|---|---|
| 13.1 上游和 Provider | upstream（账号 CRUD+测试+同步+禁用） | **缺**：独立 Provider 管理页、凭据轮换、Dry-run 下单、余额查询、能力矩阵、健康检查、请求日志、不可售原因 |
| 13.2 资源和库存 | resources（资源树+增改+库存快照+同步） | **缺**：Provider/上游资源映射界面、权重/优先级显式编排、客户可见性控制（部分可能在表单内，需验证） |
| 13.3 价格中心 | pricing（模板+规则创建） | **缺**：分等级价格表、全局价格覆盖、用户价格模板绑定、用户资源覆盖价、优惠券、折扣窗口、报价沙盒、价格变更审计 |
| 13.4 订单和履约 | orders（列表+履约详情+重试/退款/手动完成）、users 代客下单 drawer | **缺**：上游订单镜像视图、上游请求日志、队列任务视图、IP 续费搜索（按 IP/订单/客户/国家/到期）、切 IP 弹窗复制、item 级失败原因详情 |
| 13.5 用户/钱包/APIKey | users（列表+代客下单）、tenants/resellers（列表+详情+停用+品牌）、wallet（账本）、payments | **缺**：用户详情独立页（KYC/风险状态）、钱包人工充值/扣款/调账 UI（仅看到账本读取）、Admin 侧 APIKey 签发/禁用/轮换、impersonation 入口 |
| 13.7 分站运营台 | resellers 列表/详情/品牌、platform vs tenant 菜单分流、tenant-detail 多 tab | 框架在位（角色门控 + 数据范围）；**缺**：分站级统计/报表、与主站对等的续费/切IP/退款/补单运营深度 |
| 13.6 运维和风控 | audit（审计日志）、site（公告+维护模式） | **缺**：KYC 审核页、推广/返佣明细、支付异常对账、API 调用日志、限流事件、系统健康状态页 |

**Admin 端小结**：约 21 条路由 / 19 个独立页面落地，登录闭环、租户/分站管理、资源、上游、订单履约、支付、审计、站点配置、代客下单已是**完整闭环**。最明显缺：Provider 独立管理、价格中心高级能力（覆盖价/优惠券/沙盒/审计）、运维风控类页面（KYC/API日志/限流/健康/对账/返佣）、Admin 侧 APIKey 与钱包调账 UI、IP 续费搜索与切 IP 闭环、上游订单镜像/队列视图。

### Customer 端（PRD §4.2，11 项要求）

| PRD §4.2 要求 | 状态 |
|---|---|
| 概览（余额/近期订单/即将过期/代理数量/动态能力/APIKey 状态） | **部分**：仅余额，其余指标缺 |
| 静态住宅代理购买 | 完整（/buy） |
| 我的静态代理 | 完整（/proxies，含生命周期+导出） |
| 充值/虚拟余额 | 完整（/wallet/topup） |
| 账单和钱包流水 | 完整（/wallet） |
| API Key 管理 | 完整（/api-keys） |
| 代理验证工具 | 完整（/proxy-check） |
| 优惠券 | **缺** |
| 实名/风控状态 | **缺** |
| 推广或邀请入口 | **缺** |
| 反馈和工单 | 完整（/tickets + 详情） |

**Customer 端小结**：约 10 条路由 / 10 个页面落地，购买→我的代理→钱包→工单→验证→APIKey 主线**完整闭环**。最明显缺：概览页只有余额（缺近期订单/即将过期/代理数量/APIKey 状态/动态能力聚合）、优惠券、实名风控状态、推广邀请入口。

---

## Caveats / Not Found

- 完成度按前端页面渲染与端点调用判断，未核对后端这些端点是否全部真实存在/返回真数据（如 `/api/proxy-check`、代客下单路径等需后端侧另行确认）。
- `/admin/wallet` 与 `/admin/dashboard` 是否还有页内未展开的调账/趋势能力，仅凭 feature 文件判断为"部分"，未逐行读全部 admin feature。
- PRD 子节编号原文顺序为 13.1/13.2/13.3/13.4/13.5/13.7/13.6（13.7 在 13.6 之前），按原文保留。
- 动态住宅能力在 PRD 中为降级方向（§2.2），前端未见对应页面，符合当前 P0 静态主线范围，未单列为缺口。
