# 家宽代理平台重写提示词

> 用途：把这份文档作为新仓库的初始提示词，交给 Codex / Claude Code / 其他编码 Agent 执行。旧项目只能作为业务参考和反面教材，不允许复制旧架构。

## 主提示词

你现在要从零重写一个工程化、可持续迭代的「家宽代理平台」。旧项目路径仅作为需求和历史上下文参考，不作为实现模板。旧项目存在严重屎山问题：前端上帝组件、CSS 单文件堆叠、手写路由/状态/权限、失败降级为空数据、后端权限散落、currency 契约分叉、OpenAPI/运行时路由/前端类型各写一套、生产路径混入 placeholder/fallback。重写时必须删除这些坏模式，而不是“优化旧代码”。

默认中文沟通，新增文档、计划、TODO、说明优先中文。先做蓝图和工程骨架，再写业务代码。不要为了快写 mock、memory mock DB、假数据、假 UI、假订单、假库存、假余额、假权限。

## 参考站点与产品气质

参考站点：https://ipipx.365proxy.net/

新项目 Public / Customer 端可以参考 IPEasy 的产品气质，但不要照抄旧项目代码。参考要点：

- 品牌名默认使用 `IPEasy`，可在配置中覆盖为 `IPIPX` 或其他品牌。
- 主色使用干净高饱和蓝：`#0040ff` / `#003afe`，文字主色 `#101010`，正文灰 `#747689`，浅背景 `#f7f9fc`。
- 字体优先 `Inter` + `Urbanist`，中文 fallback 使用系统无衬线：`-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`。
- 官网首屏不是营销花活，而是强产品信号：Logo、导航、语言/登录入口、中心大标题、明确 CTA、4 个能力卡片。
- 首屏文案方向：`全球原生住宅 IP`、`动静态全覆盖`、`200+ 国家`、`城市级库存`、`API 自动化`、`7x24 支持`。
- 页面结构参考：Hero -> 能力卡片 -> 为什么选择 -> 全球代理池/国家库存网格 -> 产品用途/工具/教程 -> 用户评价 -> 蓝色 CTA -> Footer。
- 视觉风格：大留白、白底、浅灰分区、细边框卡片、轻阴影、圆角 8-12px；不要渐变大背景、装饰 orb、过度玻璃拟态。
- 数据展示要可信：国家/地区/库存/延迟/可用率来自真实 Provider 库存或运营配置，不允许静态假数字冒充实时覆盖。
- Public 端可以更舒展；Customer 购买台要更像工作台，优先筛选、库存、价格、购买、交付反馈；Admin 后台必须保持高密度运营台，不套官网 hero 风格。

Public 端推荐导航：

- 首页
- 购买
- 工具
- 帮助
- 推广/合作
- API 文档
- 登录 / 控制台

Customer 端推荐导航：

- 概览
- 购买静态住宅 IP
- 订单
- 代理
- 钱包
- 工单
- 教程
- 账户

Admin 端推荐导航：

- 概览
- 用户
- 租户/分站
- 供应商
- 资源库存
- 价格
- 订单履约
- 支付钱包
- 工单
- 审计日志
- 系统设置

## 重写目标

构建一个真实可发布的家宽代理平台，支持：

- 面向客户的官网、注册登录、用户中心、余额、充值、购买静态住宅代理、订单、代理实例、工单。
- 面向运营/管理员的后台，管理用户、租户、供应商、上游账号、资源、库存、价格、订单、履约、支付、钱包、审计、日志。
- 兼容 985Proxy 风格的开放接口：`apikey` 鉴权、`code/msg/data` envelope、静态住宅代理购买、查询、导出、钱包、支付等。
- 上游供应商接入：Provider、UpstreamAccount、ResourceMapping、InventorySnapshot、Fulfillment Adapter。
- 真实账务链路：PaymentOrder -> Wallet -> LedgerEntry -> Order -> Refund/Adjustment，全链路可审计。

成功标准：

- 任何核心数据都有唯一 Source of Truth。
- 前后端契约由同一份 schema/openapi 生成或校验，不手写多份漂移契约。
- 权限、资金、库存、价格、订单、审计没有 silent failure。
- 前端 server state / form state / client state 分离。
- 后台 UI 高密度、克制、可扫描；用户端购买流程清晰、可反馈、可恢复。
- 单元测试、集成测试、关键 E2E smoke check 覆盖真实失败模式。

明确不做：

- 不复制旧项目 `App.tsx`、`styles.css`、单文件大模块、placeholder 运行路径。
- 不做内存数据库或 mock DB。
- 不用静态本地列表冒充实时库存。
- 不在生产代码里 catch 后返回空数组、默认成功、默认余额、默认价格。
- 不手写临时路由系统、临时 query cache、临时 i18n。
- 不为了兼容旧 schema 保留多套字段读取；当前开发阶段优先迁移和删除旧路径。

## 冷启动流程

第一步必须产出蓝图，不要直接编码。蓝图至少包含：

- 目标、用户、成功标准、明确不做什么。
- 核心域模型、Source of Truth、关键流程。
- 技术栈决策与选择理由。
- 前端信息架构、页面模板、数据流。
- 后端模块边界、统一 contract、错误与日志。
- i18n、权限、审计、监控、测试、部署、发布。
- 仓库骨架、目录树、待定项、风险与验证方式。

初始化工程时必须初始化 Trellis：

```bash
trellis init --codex --claude --opencode -u rewrite-residential-proxy-platform
```

初始化后填充真实 spec，不能停留在模板：

- `.trellis/spec/architecture.md`
- `.trellis/spec/api-contract.md`
- `.trellis/spec/database.md`
- `.trellis/spec/frontend-ui-ux.md`
- `.trellis/spec/security-permissions.md`
- `.trellis/spec/testing-deployment.md`
- `.trellis/tasks/rewrite-blueprint.md`

## 推荐技术栈

除非项目已有强约束，否则采用以下成熟栈：

- Monorepo：pnpm workspace + Turborepo。
- 后端：NestJS 或 Fastify + TypeScript；推荐 NestJS 用 module/use case/repository/adapter 边界管理复杂业务。
- 数据库：PostgreSQL + Prisma；所有 schema 走 migration。
- 缓存/幂等/队列：Redis；幂等结果、限流、异步履约队列不要放内存。
- API contract：OpenAPI 从后端 schema 生成；前端类型由 OpenAPI 生成，不手写漂移类型。
- 校验：Zod 或 NestJS class-validator，但请求/响应 schema 要能进入 OpenAPI。
- 前端：React + Vite 或 Next.js；运营台优先 React + TanStack Router + TanStack Query + React Hook Form + Zod + Ant Design。
- 样式：设计 token + 组件库主题；禁止一个 `styles.css` 堆完整产品。
- 测试：Vitest/Jest + Supertest + Playwright；数据库集成测试用真实测试库或 Testcontainers。
- 日志观测：结构化日志、requestId/traceId、审计日志、上游请求日志。

## 架构边界

采用清晰 Module 边界：

- Domain：领域类型、不变量、状态机、金额/币种/时间等规则。
- Use Case：业务流程，负责权限、事务边界、领域规则编排。
- Repository：数据库读写，返回明确结果，不把 infra error 伪装成业务 not found。
- Adapter：上游供应商、支付渠道、短信/邮件、对象存储等外部系统。
- API Route/Controller：只做请求解析、认证上下文传入、调用 use case、返回统一响应。
- UI Route Shell：页面编排和布局。
- UI Feature Container：绑定 query/mutation/form。
- UI Presentational Component：纯展示，尽量无业务副作用。

删除测试：

- 删除某个 module 后，如果复杂度只是散回 N 个调用方，说明这个 module 有价值。
- 删除某个 wrapper 后，如果复杂度直接消失，说明它是 pass-through 垃圾抽象。

## 核心 Source of Truth

必须在 spec 和代码中明确以下 owner：

- 用户/租户：PostgreSQL `users / tenants / admin_users`。
- 权限：后端 RBAC/Scope guard 是唯一权威；前端只做展示和导航裁剪。
- APIKey：数据库 key hash + scopes + ip whitelist + owner；禁止 placeholder key 进入生产路径。
- 资源：`platform_resources`。
- 上游库存：`inventory_snapshots`，必须有 `capturedAt` 和 freshness 规则。
- 映射：`resource_mappings`。
- 价格：`price_overrides > user_price_bindings/price_templates > price_rules`。
- 资金：`payment_orders + wallets + ledger_entries`。
- 币种：先冻结单币种，统一由 `platformCurrency` 拥有；不允许入口传任意 currency 写入。
- 订单：`orders + order_items`。
- 履约：`fulfillment_jobs / upstream_order_mirrors / proxy_instances`。
- 审计：`audit_logs`。
- 上游请求：`upstream_request_logs`。
- 文案：前端 i18n locale 文件；后端返回稳定 code/reasonKey，不在响应序列化时随意改写业务 data。

## 统一 API Contract

响应 envelope：

```ts
type ApiEnvelope<T> =
  | { code: 0; msg: "success"; data: T; requestId: string }
  | {
      code: ErrorCode;
      msg: string;
      data: {
        reasonKey: string;
        reason?: string;
        details?: Record<string, unknown>;
      };
      requestId: string;
    };
```

要求：

- `code` 是稳定业务错误码。
- `reasonKey` 是稳定机器可读原因。
- `reason` 可作为人类可读说明，但不能替代错误码。
- 分页统一：`{ page, pageSize, total, items }`。
- 过滤/排序统一命名：`page/pageSize/search/sortBy/sortOrder/status/from/to`。
- 所有金额用 decimal string，不用 JS number 表示货币。
- 时间统一 ISO 8601 UTC，前端按 locale 展示。
- HTTP status 不能全部 200：认证/权限/服务错误要保留合理 HTTP status，同时 envelope 保持兼容。

OpenAPI 规则：

- 路由、scope、请求体、响应 schema 必须由统一 registry/schema 生成。
- 禁止运行时路由一份、OpenAPI `routeCatalog` 手写另一份。
- 前端 API client 从 OpenAPI 生成类型。

## 权限规则

必须有统一 guard：

- `requireAuthenticatedContext`
- `requireUserContext`
- `requireOperatorContext`
- `requireTenantAdminContext`
- `requirePlatformAdminContext`
- `requireSystemContext`

规则：

- `/system/*` 必须先过 `requireOperatorContext`，不能仅凭 scope。
- `USER` ownerType 禁止持有 `system:*` scope。
- tenant admin 只能访问本 tenant 数据。
- platform admin 可以跨 tenant，但操作必须审计。
- 用户端只能读写自己的订单、钱包、代理、工单。
- 前端权限只影响可见性，不作为真实权限判断。

必须测试：

- USER + 错误授予 `system:*` 不能访问 `/system/*`。
- tenant admin 不能跨 tenant。
- platform admin 操作产生 audit log。

## 资金与订单规则

资金链路必须事务化：

- 创建充值单只创建 `payment_order`，不改钱包。
- 支付确认必须验证渠道/人工审计权限，然后事务内写 wallet 和 ledger。
- 购买代理必须事务内扣款、建订单、保留库存/生成履约任务。
- 失败退款必须写 refund order / ledger / audit。
- 钱包余额不能从前端或支付单推断，必须从 `wallets` 读取。
- ledger 是审计账本，不能静默删除。

币种：

- 初期只支持单币种，例如 `CNY` 或 `USD`，必须写入全局配置。
- payment create、price rule、wallet adjustment、quote output 都必须校验同一币种。
- 未来多币种必须作为独立 PRD，不允许现在留下半吊子多币种入口。

## Provider 与履约

Provider Adapter 规则：

- 每个上游供应商一个 adapter。
- adapter Interface 包括 health check、inventory sync、quote/buy、order query、proxy lifecycle。
- 上游请求和响应必须脱敏记录到 `upstream_request_logs`。
- Provider credential 必须加密存储，禁止明文 fallback。
- SSRF 防护：baseUrl 必须校验协议、host、私网地址、重定向。
- 上游失败必须返回明确 `UPSTREAM_ERROR / UPSTREAM_TIMEOUT / PROVIDER_MAPPING_MISSING / UPSTREAM_OUT_OF_STOCK`。
- 没有真实上游交付时，订单保持 pending/failed，不生成假代理。

## 供应商与平台配置模板

新项目必须把供应商配置做成显式 Provider Registry，不要散落在 route handler 或页面配置里。以下配置来自当前项目环境变量结构和已有上游平台，不包含任何真实密钥。新项目 `.env.example` 可直接使用这些变量名；真实值只允许写入 `.env.local`、部署平台 secret 或 secret manager。

Provider code 统一：

| 平台 | Provider code | 默认 baseUrl | 认证方式 | 主要能力 |
| --- | --- | --- | --- | --- |
| IPIPD 平台 | `IPIPD` | `https://api.ipipd.cn` | `appId + appSecret` | 静态库存、购买、订单查询、履约 |
| 985Proxy 平台 | `NINE_EIGHT_FIVE` | `https://open-api.985proxy.com` | `apikey` 或 `username + password` | 985 风格 OpenAPI、静态购买、订单查询 |
| Proxy-Seller / proxy 平台 | `PROXY_SELLER` | `https://proxy-seller.com/personal/api/v1` | `apikey` 或 `username + password` | 代理购买、库存、SOCKS5/HTTP 交付 |

`.env.example` 模板：

```bash
# ---------- Platform ----------
APP_PUBLIC_BRAND_NAME=IPEasy
APP_PUBLIC_SITE_URL=https://ipipx.365proxy.net
APP_PUBLIC_API_URL=https://api.ipipx.365proxy.net
APP_PUBLIC_SUPPORT_EMAIL=support@example.com
APP_PLATFORM_CURRENCY=CNY
APP_TIMEZONE=Asia/Shanghai
APP_ADMIN_BASE_PATH=/admin

# ---------- Deployment ----------
NODE_ENV=production
PORT=3000
WEB_PORT=4173
WEB_PUBLIC_URL=https://ipipx.365proxy.net
API_PUBLIC_URL=https://api.ipipx.365proxy.net
API_INTERNAL_URL=http://api:3000
VITE_API_BASE_URL=/api
WEB_API_PROXY_TARGET=http://api:3000

# ---------- Database / Security ----------
DATABASE_URL=postgresql://ipipx:ipipx@localhost:15432/ipipx
REDIS_URL=redis://localhost:6379
APP_ENCRYPTION_KEY=replace-with-32-byte-base64-key
JWT_SECRET=replace-with-local-secret
TRUST_PROXY_HEADERS=false

# ---------- APIKey / Runtime Safety ----------
ALLOW_PLACEHOLDER_APIKEYS=false
PLACEHOLDER_APIKEY_SCOPES=
PLACEHOLDER_APIKEY_IP_WHITELIST=
ALLOW_LOCAL_DEV_APIKEY=false
LOCAL_DEV_APIKEY=
DIRECT_CUSTOMER_APIKEY=
SYSTEM_APIKEY=
APIKEY_RATE_LIMIT_ENABLED=true
APIKEY_RATE_LIMIT_MAX=600
APIKEY_RATE_LIMIT_WINDOW_MS=60000

# ---------- Provider Execution Gates ----------
PROVIDER_FULFILLMENT_EXECUTION_ENABLED=false
PROVIDER_FULFILLMENT_UPSTREAM_ACCOUNT_ALLOWLIST=
PROVIDER_FULFILLMENT_PROVIDER_ALLOWLIST=
STATIC_BUY_MANUAL_FULFILLMENT_QUEUE_ENABLED=false
PROVIDER_LIFECYCLE_EXECUTION_ENABLED=false
PROVIDER_LIFECYCLE_UPSTREAM_ACCOUNT_ALLOWLIST=
PROVIDER_LIFECYCLE_PROVIDER_ALLOWLIST=

# ---------- Payment ----------
PAYMENT_CONFIRMATION_ENABLED=false

# ---------- IPIPD ----------
UPSTREAM_IPIPD_STATUS=DISABLED
UPSTREAM_IPIPD_BASE_URL=https://api.ipipd.cn
UPSTREAM_IPIPD_APP_ID=
UPSTREAM_IPIPD_APP_SECRET=
UPSTREAM_IPIPD_TIMEOUT_MS=15000
UPSTREAM_IPIPD_INVENTORY_SYNC_ENABLED=false

# ---------- 985Proxy ----------
UPSTREAM_985PROXY_STATUS=DISABLED
UPSTREAM_985PROXY_BASE_URL=https://open-api.985proxy.com
UPSTREAM_985PROXY_APIKEY=
UPSTREAM_985PROXY_USERNAME=
UPSTREAM_985PROXY_PASSWORD=
UPSTREAM_985PROXY_STATIC_ZONE=
UPSTREAM_985PROXY_STATIC_BUY_PAYLOAD_STYLE=official-985
UPSTREAM_985PROXY_TIMEOUT_MS=15000
UPSTREAM_985PROXY_INVENTORY_SYNC_ENABLED=false

# ---------- Proxy-Seller / proxy platform ----------
UPSTREAM_PROXY_SELLER_STATUS=DISABLED
UPSTREAM_PROXY_SELLER_BASE_URL=https://proxy-seller.com/personal/api/v1
UPSTREAM_PROXY_SELLER_APIKEY=
UPSTREAM_PROXY_SELLER_USERNAME=
UPSTREAM_PROXY_SELLER_PASSWORD=
UPSTREAM_PROXY_SELLER_SOCKS5_URL=
UPSTREAM_PROXY_SELLER_TIMEOUT_MS=15000
UPSTREAM_PROXY_SELLER_INVENTORY_SYNC_ENABLED=false
```

配置规则：

- `STATUS` 只能是 `ACTIVE` 或 `DISABLED`；默认 `DISABLED`，没有真实凭据时绝不启用。
- `BASE_URL` 必须通过 SSRF 校验，禁止内网地址、file 协议、无协议地址、危险重定向。
- `APP_ID / APP_SECRET / APIKEY / USERNAME / PASSWORD / SOCKS5_URL` 全部是 secret，不得写进仓库文档、测试快照、日志或 OpenAPI。
- `PROVIDER_FULFILLMENT_EXECUTION_ENABLED=true` 时必须配置 allowlist，例如 `IPIPD,NINE_EIGHT_FIVE,PROXY_SELLER`，否则生产启动失败。
- Provider Adapter 必须从统一配置服务读取这些变量，禁止页面、route、use case 直接读 `process.env`。
- 上游响应必须脱敏后记录，字段至少包括 `providerCode`、`upstreamAccountId`、`operation`、`requestId`、`durationMs`、`status`、`errorCode`。
- `UPSTREAM_PROXY_SELLER_SOCKS5_URL` 只可作为上游连接配置，不可展示给普通用户；用户得到的代理实例必须来自履约结果并写入 `proxy_instances`。

Provider Registry Interface：

```ts
type ProviderCode = "IPIPD" | "NINE_EIGHT_FIVE" | "PROXY_SELLER";

type ProviderRuntimeConfig = {
  code: ProviderCode;
  status: "ACTIVE" | "DISABLED";
  baseUrl: string;
  timeoutMs: number;
  inventorySyncEnabled: boolean;
  auth:
    | { type: "app_secret"; appId: SecretRef; appSecret: SecretRef }
    | { type: "apikey"; apiKey: SecretRef }
    | { type: "password"; username: SecretRef; password: SecretRef };
};

interface ProviderAdapter {
  code: ProviderCode;
  healthCheck(config: ProviderRuntimeConfig): Promise<ProviderHealthResult>;
  syncInventory(config: ProviderRuntimeConfig): Promise<InventorySyncResult>;
  buyStaticProxy(input: StaticProxyBuyInput, config: ProviderRuntimeConfig): Promise<ProviderBuyResult>;
  queryOrder(input: ProviderOrderQuery, config: ProviderRuntimeConfig): Promise<ProviderOrderResult>;
}
```

## 部署拓扑与发布流程

新项目部署优先支持 Railway，同时保留 Docker Compose 作为本地/预发替代。部署信息必须进入 `.trellis/spec/testing-deployment.md`，不能只存在聊天记录。

推荐服务拓扑：

| 服务 | 说明 | 健康检查 | 备注 |
| --- | --- | --- | --- |
| `web` | Public / Customer / Admin 前端静态服务或 SSR 服务 | `/healthz` | 绑定 `https://ipipx.365proxy.net` |
| `api` | 后端 API / OpenAPI / Auth / Use Case | `/health` 和 `/ready` | 可绑定 `https://api.ipipx.365proxy.net`，也可由 web 反代 `/api` |
| `worker` | 履约、库存同步、回调补偿、审计异步任务 | `/health` | 可第一阶段暂不独立，但队列接口要预留 |
| `postgres` | 主数据库 | 平台托管健康检查 | 生产只跑 versioned migration |
| `redis` | 幂等、限流、队列、短期缓存 | 平台托管健康检查 | 多实例部署前必须启用 |

域名规则：

- Public / Customer / Admin：`https://ipipx.365proxy.net`。
- Admin 路径：`/admin`，不要单独做一个散落权限逻辑的后台入口。
- API 推荐：`https://api.ipipx.365proxy.net`。
- 如果前端和 API 同域部署，浏览器调用统一走 `/api/*`，由 web server 或 gateway 代理到 API 内网地址。
- 不允许把 `SYSTEM_APIKEY`、Provider secret 或任何后台 key 注入浏览器 bundle；Admin 必须走登录态 / HttpOnly session / 后端 RBAC。

Railway 推荐配置：

API service:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "pnpm --filter @ipeasy/api build"
  },
  "deploy": {
    "preDeployCommand": "pnpm --filter @ipeasy/db migrate:deploy",
    "startCommand": "NODE_ENV=production pnpm --filter @ipeasy/api start:prod",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 100,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

Web service:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "pnpm --filter @ipeasy/web build"
  },
  "deploy": {
    "startCommand": "NODE_ENV=production pnpm --filter @ipeasy/web start",
    "healthcheckPath": "/healthz",
    "healthcheckTimeout": 100,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

Worker service:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "pnpm --filter @ipeasy/worker build"
  },
  "deploy": {
    "startCommand": "NODE_ENV=production pnpm --filter @ipeasy/worker start",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 100,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

部署环境变量分组：

- `Platform`：`APP_PUBLIC_BRAND_NAME`、`APP_PUBLIC_SITE_URL`、`APP_PUBLIC_API_URL`、`APP_PLATFORM_CURRENCY`、`APP_TIMEZONE`。
- `Runtime`：`NODE_ENV`、`PORT`、`WEB_PORT`、`WEB_API_PROXY_TARGET`、`TRUST_PROXY_HEADERS`。
- `Data`：`DATABASE_URL`、`REDIS_URL`。
- `Security`：`APP_ENCRYPTION_KEY`、`JWT_SECRET`、APIKey 相关开关。
- `Providers`：IPIPD、985Proxy、Proxy-Seller 的 baseUrl、status、credential secret。
- `Execution Gates`：Provider fulfillment/lifecycle/payment confirmation 开关和 allowlist。

从 `.env.local` 导入部署平台 Secret/Variables：

原则：

- `.env.local` 是本机 secret 来源，允许用于“读取后上传到部署平台”，不允许把真实值写进仓库、文档、截图、测试快照或聊天记录。
- Web 服务只能拿非敏感公开配置；API/Worker 才能拿数据库、JWT、Provider、Payment、APIKey secret。
- 不要把 `SYSTEM_APIKEY`、`DIRECT_CUSTOMER_APIKEY`、Provider credential、`UPSTREAM_PROXY_SELLER_SOCKS5_URL` 注入浏览器 bundle。
- `LOCAL_DEV_APIKEY`、`SEED_DEV_APIKEY`、`PLACEHOLDER_APIKEY_SCOPES`、`PLACEHOLDER_APIKEY_IP_WHITELIST` 只用于本地/测试，生产不要导入。
- 生产应显式设置 `ALLOW_PLACEHOLDER_APIKEYS=false`、`ALLOW_LOCAL_DEV_APIKEY=false`，不要从本机历史值继承。

API / Worker 应导入的变量：

```txt
DATABASE_URL
REDIS_URL
APP_ENCRYPTION_KEY
JWT_SECRET
APP_PLATFORM_CURRENCY
APP_TIMEZONE
TRUST_PROXY_HEADERS
APIKEY_RATE_LIMIT_ENABLED
APIKEY_RATE_LIMIT_MAX
APIKEY_RATE_LIMIT_WINDOW_MS
DIRECT_CUSTOMER_APIKEY
SYSTEM_APIKEY
PROVIDER_FULFILLMENT_EXECUTION_ENABLED
PROVIDER_FULFILLMENT_UPSTREAM_ACCOUNT_ALLOWLIST
PROVIDER_FULFILLMENT_PROVIDER_ALLOWLIST
STATIC_BUY_MANUAL_FULFILLMENT_QUEUE_ENABLED
PROVIDER_LIFECYCLE_EXECUTION_ENABLED
PROVIDER_LIFECYCLE_UPSTREAM_ACCOUNT_ALLOWLIST
PROVIDER_LIFECYCLE_PROVIDER_ALLOWLIST
PAYMENT_CONFIRMATION_ENABLED
UPSTREAM_IPIPD_STATUS
UPSTREAM_IPIPD_BASE_URL
UPSTREAM_IPIPD_APP_ID
UPSTREAM_IPIPD_APP_SECRET
UPSTREAM_IPIPD_TIMEOUT_MS
UPSTREAM_IPIPD_INVENTORY_SYNC_ENABLED
UPSTREAM_985PROXY_STATUS
UPSTREAM_985PROXY_BASE_URL
UPSTREAM_985PROXY_APIKEY
UPSTREAM_985PROXY_USERNAME
UPSTREAM_985PROXY_PASSWORD
UPSTREAM_985PROXY_STATIC_ZONE
UPSTREAM_985PROXY_STATIC_BUY_PAYLOAD_STYLE
UPSTREAM_985PROXY_TIMEOUT_MS
UPSTREAM_985PROXY_INVENTORY_SYNC_ENABLED
UPSTREAM_PROXY_SELLER_STATUS
UPSTREAM_PROXY_SELLER_BASE_URL
UPSTREAM_PROXY_SELLER_APIKEY
UPSTREAM_PROXY_SELLER_USERNAME
UPSTREAM_PROXY_SELLER_PASSWORD
UPSTREAM_PROXY_SELLER_SOCKS5_URL
UPSTREAM_PROXY_SELLER_TIMEOUT_MS
UPSTREAM_PROXY_SELLER_INVENTORY_SYNC_ENABLED
```

Web 服务只允许导入这些变量：

```txt
NODE_ENV
WEB_PORT
WEB_PUBLIC_URL
API_PUBLIC_URL
APP_PUBLIC_BRAND_NAME
APP_PUBLIC_SITE_URL
APP_PUBLIC_API_URL
APP_PUBLIC_SUPPORT_EMAIL
APP_ADMIN_BASE_PATH
VITE_API_BASE_URL
WEB_API_PROXY_TARGET
```

生产强制覆盖变量，不从 `.env.local` 继承：

```txt
NODE_ENV=production
ALLOW_PLACEHOLDER_APIKEYS=false
ALLOW_LOCAL_DEV_APIKEY=false
LOCAL_DEV_APIKEY=
SEED_DEV_APIKEY=
PLACEHOLDER_APIKEY_SCOPES=
PLACEHOLDER_APIKEY_IP_WHITELIST=
```

Railway PowerShell 导入脚本。运行前先执行 `railway login` 并 link 到正确项目；脚本只打印变量名，不打印值：

```powershell
$envPath = ".env.local"
$environment = "production"
$apiService = "api"
$workerService = "worker"
$webService = "web"

if (-not (Test-Path -LiteralPath $envPath)) {
  throw ".env.local not found"
}

function Read-DotEnv($path) {
  $result = @{}
  Get-Content -LiteralPath $path | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
      $name, $value = $line -split "=", 2
      $name = $name.Trim()
      $value = $value.Trim()

      if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
        $value = $value.Substring(1, $value.Length - 2)
      }

      $result[$name] = $value
    }
  }
  return $result
}

function Set-RailwayVars($service, $vars, $keys) {
  foreach ($key in $keys) {
    if (-not $vars.ContainsKey($key)) {
      continue
    }

    $value = $vars[$key]
    railway variables --service $service --environment $environment --set "$key=$value" | Out-Null
    Write-Host "set $service/$key"
  }
}

$vars = Read-DotEnv $envPath

$apiAndWorkerKeys = @(
  "DATABASE_URL",
  "REDIS_URL",
  "APP_ENCRYPTION_KEY",
  "JWT_SECRET",
  "APP_PLATFORM_CURRENCY",
  "APP_TIMEZONE",
  "TRUST_PROXY_HEADERS",
  "APIKEY_RATE_LIMIT_ENABLED",
  "APIKEY_RATE_LIMIT_MAX",
  "APIKEY_RATE_LIMIT_WINDOW_MS",
  "DIRECT_CUSTOMER_APIKEY",
  "SYSTEM_APIKEY",
  "PROVIDER_FULFILLMENT_EXECUTION_ENABLED",
  "PROVIDER_FULFILLMENT_UPSTREAM_ACCOUNT_ALLOWLIST",
  "PROVIDER_FULFILLMENT_PROVIDER_ALLOWLIST",
  "STATIC_BUY_MANUAL_FULFILLMENT_QUEUE_ENABLED",
  "PROVIDER_LIFECYCLE_EXECUTION_ENABLED",
  "PROVIDER_LIFECYCLE_UPSTREAM_ACCOUNT_ALLOWLIST",
  "PROVIDER_LIFECYCLE_PROVIDER_ALLOWLIST",
  "PAYMENT_CONFIRMATION_ENABLED",
  "UPSTREAM_IPIPD_STATUS",
  "UPSTREAM_IPIPD_BASE_URL",
  "UPSTREAM_IPIPD_APP_ID",
  "UPSTREAM_IPIPD_APP_SECRET",
  "UPSTREAM_IPIPD_TIMEOUT_MS",
  "UPSTREAM_IPIPD_INVENTORY_SYNC_ENABLED",
  "UPSTREAM_985PROXY_STATUS",
  "UPSTREAM_985PROXY_BASE_URL",
  "UPSTREAM_985PROXY_APIKEY",
  "UPSTREAM_985PROXY_USERNAME",
  "UPSTREAM_985PROXY_PASSWORD",
  "UPSTREAM_985PROXY_STATIC_ZONE",
  "UPSTREAM_985PROXY_STATIC_BUY_PAYLOAD_STYLE",
  "UPSTREAM_985PROXY_TIMEOUT_MS",
  "UPSTREAM_985PROXY_INVENTORY_SYNC_ENABLED",
  "UPSTREAM_PROXY_SELLER_STATUS",
  "UPSTREAM_PROXY_SELLER_BASE_URL",
  "UPSTREAM_PROXY_SELLER_APIKEY",
  "UPSTREAM_PROXY_SELLER_USERNAME",
  "UPSTREAM_PROXY_SELLER_PASSWORD",
  "UPSTREAM_PROXY_SELLER_SOCKS5_URL",
  "UPSTREAM_PROXY_SELLER_TIMEOUT_MS",
  "UPSTREAM_PROXY_SELLER_INVENTORY_SYNC_ENABLED"
)

$webKeys = @(
  "WEB_PORT",
  "WEB_PUBLIC_URL",
  "API_PUBLIC_URL",
  "APP_PUBLIC_BRAND_NAME",
  "APP_PUBLIC_SITE_URL",
  "APP_PUBLIC_API_URL",
  "APP_PUBLIC_SUPPORT_EMAIL",
  "APP_ADMIN_BASE_PATH",
  "VITE_API_BASE_URL",
  "WEB_API_PROXY_TARGET"
)

Set-RailwayVars $apiService $vars $apiAndWorkerKeys
Set-RailwayVars $workerService $vars $apiAndWorkerKeys
Set-RailwayVars $webService $vars $webKeys

railway variables --service $apiService --environment $environment --set "NODE_ENV=production" | Out-Null
railway variables --service $workerService --environment $environment --set "NODE_ENV=production" | Out-Null
railway variables --service $webService --environment $environment --set "NODE_ENV=production" | Out-Null
railway variables --service $apiService --environment $environment --set "ALLOW_PLACEHOLDER_APIKEYS=false" | Out-Null
railway variables --service $apiService --environment $environment --set "ALLOW_LOCAL_DEV_APIKEY=false" | Out-Null
railway variables --service $workerService --environment $environment --set "ALLOW_PLACEHOLDER_APIKEYS=false" | Out-Null
railway variables --service $workerService --environment $environment --set "ALLOW_LOCAL_DEV_APIKEY=false" | Out-Null
```

导入后检查，只看变量名和关键非敏感状态，不打印 secret。不要在共享终端裸跑会显示变量值的命令；优先在部署平台 Dashboard 查看变量是否存在。如果 Railway CLI 支持 JSON 输出，可以只打印变量名：

```powershell
foreach ($service in @("api", "web", "worker")) {
  $items = railway variables --service $service --environment production --json | ConvertFrom-Json
  Write-Host "service: $service"
  $items | ForEach-Object {
    $name = $_.name ?? $_.key ?? $_.variableName
    if ($name) {
      Write-Host "  $name"
    }
  }
}
```

如果部署平台不是 Railway，仍按同一份清单导入：

- `api` 和 `worker`：导入 API / Worker 清单。
- `web`：只导入 Web 清单。
- 所有 secret 使用平台的 Secret/Variables 功能，不写进 Dockerfile、镜像、前端 `.env.production` 或静态资源。

生产启动门禁：

- `NODE_ENV=production` 必须显式设置。
- `DATABASE_URL`、`REDIS_URL` 必须存在。
- `APP_ENCRYPTION_KEY` 必须是非 placeholder 的 32-byte key。
- `JWT_SECRET` 必须是非 placeholder secret。
- `APP_PLATFORM_CURRENCY` 必须固定，第一阶段只允许单币种。
- `ALLOW_PLACEHOLDER_APIKEYS=false`。
- `ALLOW_LOCAL_DEV_APIKEY=false`。
- `TRUST_PROXY_HEADERS` 只有在 Railway / 可信反代后面才允许开启。
- Provider 凭据存在但 `STATUS=DISABLED` 时不允许执行上游调用。
- `PROVIDER_FULFILLMENT_EXECUTION_ENABLED=true` 时必须配置 provider 或 upstream account allowlist。
- `PAYMENT_CONFIRMATION_ENABLED=true` 之前必须完成支付渠道签名验证、人工确认 RBAC、对账和审计。

迁移规则：

- 部署前只允许执行 `migrate:deploy`。
- 禁止在生产、灰度、预发使用 `prisma db push`。
- 禁止生产运行 seed、测试数据脚本、临时修补 SQL。
- 已经应用到生产的 migration 不允许修改；错误只能通过新的 corrective migration 修复。
- migration 失败必须让部署失败，不能跳过。

Provider 运营命令：

```bash
pnpm --filter @ipeasy/api providers:health-check
pnpm --filter @ipeasy/api providers:sync-inventory
pnpm --filter @ipeasy/api providers:test-buy --provider IPIPD --dry-run
```

规则：

- Provider 连接、库存同步、测试购买不能作为部署自动副作用执行。
- 每次启用新 Provider，先健康检查，再同步库存，再做 dry-run，再做小额真实购买。
- 上游测试购买必须写 audit log 和 upstream request log。

灰度发布流程：

1. 部署 `api` 单实例，确认 `/health`、`/ready`、`/openapi.json`。
2. 执行迁移验证和启动门禁。
3. 配置真实站点、管理员、APIKey、Provider 账号、资源映射、价格。
4. 手动跑 Provider health check 和 inventory sync。
5. 用测试用户完成：充值单创建 -> 人工确认/测试确认 -> 余额流水 -> 报价 -> 购买 -> 履约 -> 代理导出。
6. 检查 audit log、upstream request log、ledger、order、proxy instance。
7. 再开放公开域名或扩大流量。

生产 smoke check：

```bash
curl -fsS https://api.ipipx.365proxy.net/health
curl -fsS https://api.ipipx.365proxy.net/ready
curl -fsS https://ipipx.365proxy.net/healthz
curl -fsS https://api.ipipx.365proxy.net/openapi.json
```

发布后必须人工确认：

- 官网可访问，登录页可访问。
- Admin 登录后用户/订单/钱包/审计列表不是假空数据。
- Customer 余额、订单、代理列表错误态明确。
- API 文档中的 route/scope 与运行时一致。
- Provider 未启用时购买路径 fail closed，不生成假代理。

回滚规则：

- 应用版本可回滚，数据库 migration 不回滚。
- 数据库问题用 forward-only corrective migration。
- Provider 事故优先关闭 `PROVIDER_FULFILLMENT_EXECUTION_ENABLED` 或对应 `UPSTREAM_*_STATUS=DISABLED`。
- 支付事故优先关闭 `PAYMENT_CONFIRMATION_ENABLED`。
- 公开事故必须保留 audit/upstream/request log，不允许清空日志掩盖问题。

## 前端信息架构

前端拆分为三个 surface：

- Public：官网、登录、注册、价格展示、帮助。
- Customer：仪表盘、购买、订单、代理、余额、充值、工单、账户。
- Admin：概览、用户、租户、资源、供应商、价格、订单、履约、支付、钱包、审计、日志、设置。

推荐目录：

```txt
apps/web/src/
  app/
    router.tsx
    providers.tsx
  shared/
    api/
    i18n/
    ui/
    hooks/
    utils/
  features/
    auth/
    customer-orders/
    customer-proxies/
    wallet/
    pricing/
    admin-users/
    admin-providers/
    admin-orders/
    admin-fulfillment/
  routes/
    public/
    customer/
    admin/
```

状态规则：

- server state：TanStack Query。
- form state：React Hook Form + Zod。
- client state：只放 UI 交互，例如 drawer open、tab、selected rows。
- mutation 成功后通过 query invalidation 或 optimistic update 更新。
- 不允许 API catch 后返回空数组冒充无数据。

UI/UX：

- 后台用高密度工具模板：sidebar/topbar + toolbar + filters + table + drawer/modal + audit timeline。
- 用户端购买流程必须有明确 loading、quote、余额不足、库存不足、支付、交付中、失败退款状态。
- 所有表单有校验、提交中、错误、成功反馈。
- 所有列表有 loading、empty、error、permission、pagination。
- 移动端至少覆盖用户端核心流程。
- a11y：label、focus、keyboard、aria、reduced motion。
- 文案全部走 i18n，不在组件里散落硬编码。

## 后端推荐目录

```txt
apps/api/src/
  main.ts
  app.module.ts
  common/
    config/
    errors/
    logging/
    auth/
    pagination/
    money/
    time/
  modules/
    auth/
    users/
    tenants/
    api-keys/
    providers/
    resources/
    pricing/
    wallet/
    payments/
    orders/
    fulfillment/
    proxies/
    audit/
    openapi/
  integrations/
    providers/
    payments/
  prisma/
packages/
  db/
  contracts/
  config/
```

每个后端模块至少区分：

```txt
module/
  domain.ts
  dto.ts
  repository.ts
  use-cases/
  controller.ts
  tests/
```

## 测试策略

必须优先写真测试：

- Domain：金额、币种、状态机、权限判断、价格优先级。
- Use Case：购买、充值确认、退款、库存不足、价格缺失、上游失败。
- Repository：真实测试库验证查询语义。
- API：Supertest 覆盖 envelope、scope、tenant 边界。
- Frontend：Vitest + Testing Library 覆盖路由守卫、关键表单、错误态。
- E2E：Playwright 覆盖用户登录、购买失败/成功路径、后台订单处理。

禁止：

- 测 mock 调用次数冒充行为测试。
- snapshot 锁死大 UI。
- 为了通过测试放宽断言。
- memory mock DB 伪造成功。

关键必测：

- USER 不能访问 `/system/*`。
- tenant admin 不能跨 tenant。
- DB 故障不能被返回成空列表或业务未配置。
- 非平台币种不能进入资金链路。
- 购买失败不会生成假代理。
- 支付确认必须写 wallet + ledger + audit。

## 验证与发布门禁

每个 PR 至少运行：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

涉及 UI 的 PR 额外运行：

```bash
pnpm e2e
```

涉及 DB 的 PR：

```bash
pnpm prisma migrate dev
pnpm test:integration
```

生产启动必须检查：

- `DATABASE_URL` 存在。
- 加密 key 非 placeholder。
- placeholder API key 禁用。
- 本地开发 API key 禁用。
- Provider 执行灰度 allowlist 存在。
- payment confirmation 没有验证机制时禁用。

## 从旧项目迁移的规则

旧项目只能用于：

- 提取业务名词。
- 对照页面需求。
- 识别错误做法。
- 参考测试里真实失败模式。

旧项目禁止用于：

- 复制 `App.tsx`。
- 复制 `styles.css`。
- 复制 placeholder/fallback 运行路径。
- 复制手写 OpenAPI routeCatalog。
- 复制“失败返回空页/空钱包”。
- 复制资金多币种半成品。

迁移顺序：

1. 写新项目蓝图和 Trellis spec。
2. 建 DB schema 和 contract。
3. 做 auth/APIKey/RBAC。
4. 做 wallet/payment/ledger。
5. 做 resources/pricing/orders。
6. 做 provider adapter/fulfillment。
7. 做前端 public/customer/admin 三个 surface。
8. 做 E2E 和生产 smoke。

## 第一阶段交付物

第一阶段不要追求全功能，先交付真实骨架：

- Monorepo 初始化。
- Trellis spec 完成。
- PostgreSQL + Prisma schema/migration。
- OpenAPI 生成与前端类型生成。
- Auth/APIKey/RBAC。
- Wallet/Payment/Ledger 单币种链路。
- Admin 最小页面：登录、用户列表、钱包流水、支付单、审计日志。
- Customer 最小页面：登录、余额、充值单、流水。
- 测试覆盖权限、资金、错误传播。

第一阶段完成后再进入代理购买和 Provider 履约，不要把所有复杂度一次性糊进一个文件。
