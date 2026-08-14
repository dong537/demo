# IPIPX 家宽代理平台重写蓝图草案

状态：草案，待用户批准  
阶段：brainstorming  
输入：`PRD.md`、`REWRITE_PROJECT_PROMPT.md`、`EXECUTION_PLAN.md`、Superpowers 7 步流程文章  
约束：批准前不写业务代码、不搭 UI 壳、不创建假数据、不绕过 Trellis

## 0. 待批准决策

本蓝图先给出推荐路线。进入工程初始化前，需要用户确认以下决策。

### 决策 A：第一阶段范围

推荐：第一阶段只交付真实工程骨架和资金/权限闭环，不进入代理购买与 Provider 履约。

第一阶段包含：

- Monorepo 初始化。
- Trellis spec 完成。
- PostgreSQL + Prisma schema/migration。
- OpenAPI 生成与前端类型生成。
- Auth/APIKey/RBAC。
- Wallet/Payment/Ledger 单币种链路。
- Admin 最小页面：登录、用户列表、钱包流水、支付单、审计日志。
- Customer 最小页面：登录、余额、充值单、流水。
- 测试覆盖权限、资金、错误传播。

第一阶段不包含：

- 静态住宅代理购买。
- Provider 真实履约。
- 资源映射工作台完整交互。
- 支付宝/易支付真实线上收款。
- 动态住宅代理生产化。

理由：资金、权限、契约和审计是平台地基。先把这些做实，后续代理购买和 Provider 履约才能接到正确的 Source of Truth 上。

替代方案：第一阶段同时做购买与 Provider。风险是任务跨度过大，容易在资金、库存、履约和 UI 之间塞 placeholder/fallback，正好踩中重写文档明确禁止的问题。

### 决策 B：技术栈

推荐：

- Monorepo：pnpm workspace + Turborepo。
- 后端：NestJS + TypeScript。
- 数据库：PostgreSQL + Prisma migration。
- Redis：幂等、限流、队列、短期缓存。
- API contract：后端 schema 生成 OpenAPI，前端类型由 OpenAPI 生成。
- 前端：React + Vite + TanStack Router + TanStack Query + React Hook Form + Zod + Ant Design。
- 测试：Vitest/Jest + Supertest + Playwright；DB 集成测试用真实测试库或 Testcontainers。

理由：项目业务边界复杂，NestJS 的 module/use case/repository/adapter 结构更适合承载权限、资金、订单、履约和审计。Ant Design 更适合高密度 Admin 运营台。

替代方案：Fastify + 手工模块。优点是轻，缺点是需要自己约束模块边界和 OpenAPI 生成路径，重写项目早期更容易写散。

### 决策 C：部署优先级

推荐：Railway 为生产优先部署目标，Docker Compose 作为本地/预发替代。

理由：`REWRITE_PROJECT_PROMPT.md` 已经给出 Railway 服务拓扑、环境变量分组、迁移规则和 smoke check。直接采用可以减少部署设计摇摆。

替代方案：先 Docker Compose，后 Railway。风险是生产环境门禁、secret 边界、health/readiness 检查可能后补，容易形成两套部署契约。

## 1. 目标、用户、成功标准

### 1.1 产品目标

构建一个工程化、可持续迭代、真实可发布的 985Proxy-compatible OpenAPI 家宽代理平台。平台面向静态住宅代理交易、交付和分销，核心形态是每一层站点既是 Upstream Consumer，又是 Downstream Provider。

### 1.2 用户

- 终端客户：注册登录、充值、购买静态住宅 IP、查看订单、复制和导出代理。
- API 客户：通过 `apikey` header 调用 `/res_static/*` 获取业务、库存、报价、下单和查询。
- 平台 Admin：配置上游、资源、价格、用户、钱包、订单、审计和系统状态。
- Reseller 分站平台 Admin：管理分站、公共上游、代理商租户和全站运营数据。
- 代理商租户 Admin：管理自己租户下客户、价格、钱包、订单、APIKey 和审计。

### 1.3 成功标准

- 核心数据都有唯一 Source of Truth。
- 前后端契约由同一份 schema/OpenAPI 生成或校验。
- 权限、资金、库存、价格、订单、审计没有 silent failure。
- 前端 server state、form state、client state 分离。
- Admin 是高密度运营台，不是表格堆砌或官网皮肤。
- Customer 购买和钱包流程有 loading、empty、error、success、permission 和审计路径。
- 测试覆盖真实失败模式，而不是 mock 调用次数。

### 1.4 明确不做

- 不复制旧项目代码结构、单文件大组件或单文件 CSS。
- 不做 memory mock DB。
- 不使用静态本地列表冒充库存、余额、订单或价格。
- 不在生产路径使用 catch 后空数组、默认成功、默认价格、默认余额。
- 不在第一阶段实现动态住宅代理生产能力。
- 不在第一阶段实现完整 Provider 履约。
- 不为未来多币种留下半成品入口。

## 2. 核心域模型

### 2.1 站点与租户

- `Site`：一个部署站点，可为主站或 Reseller 分站。
- `Tenant`：共享分站中的代理商租户；主站也可用默认 tenant 简化统一边界。
- `User`：终端客户，必须归属站点和租户。
- `AdminUser`：平台或租户后台操作者。
- `ApiKey`：对外 OpenAPI 鉴权凭据，只展示一次，数据库只保存 hash。

### 2.2 权限

- `AuthenticatedContext`：所有登录态或 APIKey 解析后的统一上下文。
- `OwnerType`：`USER`、`TENANT_ADMIN`、`PLATFORM_ADMIN`、`SYSTEM`。
- `Scope`：APIKey 或后台能力范围。
- `AuditLog`：高危操作、资金变化、权限变化、impersonation、Provider 操作都必须写。

### 2.3 资金

- `Wallet`：余额 Source of Truth，包含 available、frozen、currency。
- `LedgerEntry`：审计账本，不允许静默删除。
- `PaymentOrder`：充值单，创建时不改钱包。
- `Refund` / `Adjustment`：退款和调账必须有 reason + idempotencyKey。

### 2.4 资源、价格、库存

- `PlatformResource`：本层资源树。
- `InventorySnapshot`：上游库存快照，有 capturedAt 和 freshness。
- `ResourceMapping`：本层资源到上游资源的映射。
- `PriceTemplate`、`PriceRule`、`PriceOverride`：价格规则。
- `Quote`：报价结果，不单独作为权威价格存储，订单创建时保存报价镜像。

### 2.5 订单与履约

- `Order`、`OrderItem`：本层订单 Source of Truth。
- `FulfillmentJob`：异步履约任务。
- `UpstreamOrderMirror`：直接上游订单镜像。
- `ProxyInstance`：已交付静态代理实例镜像。
- `UpstreamRequestLog`：Provider 或上游 OpenAPI 请求响应脱敏日志。

## 3. Source of Truth

| 领域 | Source of Truth | 说明 |
| --- | --- | --- |
| 用户/租户 | PostgreSQL `users / tenants / admin_users` | 所有业务对象必须带站点/租户边界 |
| 权限 | 后端 RBAC/Scope guard | 前端只控制展示和导航 |
| APIKey | `api_keys` 的 hash/scopes/ipWhitelist/owner | 明文只展示一次 |
| 资源 | `platform_resources` | 前端不能硬编码可售国家 |
| 库存 | `inventory_snapshots` | 必须有 capturedAt 和 freshness |
| 映射 | `resource_mappings` | 缺映射必须 fail closed |
| 价格 | `price_overrides > user_price_bindings/price_templates > price_rules` | 金额用 decimal string |
| 资金 | `payment_orders + wallets + ledger_entries` | 余额只读 `wallets` |
| 币种 | `platformCurrency` 配置 | 第一阶段单币种 |
| 订单 | `orders + order_items` | 保存报价、支付、资源、租户镜像 |
| 履约 | `fulfillment_jobs / upstream_order_mirrors / proxy_instances` | 没有真实交付不生成假代理 |
| 审计 | `audit_logs` | 高危操作必须可追踪 |
| 上游请求 | `upstream_request_logs` | 请求响应脱敏记录 |
| 文案 | 前端 i18n locale + 后端 reasonKey | 后端返回稳定 code/reasonKey |

## 4. 关键业务流程

### 4.1 登录与权限流程

```txt
登录/APIKey -> 解析 AuthenticatedContext -> guard 校验 owner/scope/tenant -> use case -> repository -> audit
```

规则：

- `/system/*` 必须先过 `requireOperatorContext`。
- `USER` ownerType 禁止持有 `system:*` scope。
- tenant admin 只能访问本 tenant 数据。
- platform admin 可跨 tenant，但所有写操作必须审计。

### 4.2 充值确认流程

```txt
用户创建充值单 -> payment_order=PENDING
人工确认或支付回调 -> 校验权限/签名/幂等
事务内更新 wallet + ledger_entry + payment_order
写 audit log
返回统一 envelope
```

失败规则：

- 创建充值单不改钱包。
- 支付确认失败不能默认成功。
- DB 故障不能返回空流水。

### 4.3 第一阶段钱包查询流程

```txt
Customer/Admin 请求钱包 -> guard 校验租户/用户 -> 读 wallets + ledger_entries -> envelope
```

UI 必须区分：

- loading。
- empty。
- permission denied。
- server error。
- success。

### 4.4 第二阶段静态代理购买流程

第二阶段才进入该流程。

```txt
选择资源/时长/数量 -> quote use case
校验资源映射/库存/价格/用户可见性
事务内扣钱包、建订单、建履约任务
worker 调用直接上游
记录 upstream_request_log
成功：保存 upstream_order_mirror + proxy_instance
失败：订单进入可处理状态，必要时退款并写 ledger/audit
```

失败规则：

- 缺资源映射、缺价格、库存不足、Provider 未启用都必须 fail closed。
- 未真实履约时不生成假代理。

## 5. 后端架构

### 5.1 模块边界

```txt
apps/api/src/
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
```

每个业务模块至少包含：

```txt
module/
  domain.ts
  dto.ts
  repository.ts
  use-cases/
  controller.ts
  tests/
```

### 5.2 分层职责

- Domain：领域类型、不变量、状态机、金额、币种、时间规则。
- Use Case：业务流程、事务边界、权限上下文、领域规则编排。
- Repository：数据库读写，不把 infra error 伪装成业务 not found。
- Adapter：Provider、支付渠道、邮件短信、对象存储等外部系统。
- Controller：请求解析、认证上下文传入、调用 use case、返回统一响应。

### 5.3 统一 API Contract

所有接口返回统一 envelope：

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

规则：

- `code` 是稳定业务错误码。
- `reasonKey` 是机器可读稳定原因。
- 分页统一为 `{ page, pageSize, total, items }`。
- 金额统一 decimal string。
- 时间统一 ISO 8601 UTC。
- HTTP status 不能全部 200。
- OpenAPI 从后端 schema 生成，前端类型从 OpenAPI 生成。

## 6. 前端架构

### 6.1 三个 surface

- Public：官网、登录、注册、价格展示、帮助、API 文档入口。
- Customer：概览、购买静态住宅 IP、订单、代理、钱包、工单、教程、账户。
- Admin：概览、用户、租户/分站、供应商、资源库存、价格、订单履约、支付钱包、工单、审计日志、系统设置。

### 6.2 推荐目录

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

### 6.3 状态边界

- server state：TanStack Query。
- form state：React Hook Form + Zod。
- client state：drawer open、tab、selected rows 等纯 UI 状态。
- mutation 成功后通过 query invalidation 或乐观更新处理。
- 禁止 API catch 后返回空数组冒充无数据。

### 6.4 UI/UX 原则

- Admin：高密度运营台，sidebar/topbar + toolbar + filters + table + drawer/modal + audit timeline。
- Customer：工作台式购买和钱包流程，优先筛选、报价、余额、库存、支付、交付反馈。
- Public：可参考 IPEasy 气质，但数据展示必须来自真实 Provider 库存或运营配置。
- 所有列表有 loading、empty、error、permission、pagination。
- 所有表单有校验、提交中、错误、成功反馈。
- 用户可见文案走 i18n，不在组件散落硬编码。

## 7. 数据库与迁移

### 7.1 第一阶段核心表

第一阶段建议至少覆盖：

- `sites`
- `tenants`
- `users`
- `admin_users`
- `sessions`
- `api_keys`
- `wallets`
- `ledger_entries`
- `payment_orders`
- `audit_logs`
- `system_settings`

第二阶段再加入：

- `provider_accounts`
- `platform_resources`
- `inventory_snapshots`
- `resource_mappings`
- `price_templates`
- `price_rules`
- `price_overrides`
- `orders`
- `order_items`
- `fulfillment_jobs`
- `upstream_order_mirrors`
- `proxy_instances`
- `upstream_request_logs`

### 7.2 迁移规则

- 所有 schema 走 Prisma migration。
- 禁止生产、灰度、预发使用 `prisma db push`。
- 已应用生产 migration 不修改，只用新的 corrective migration 修复。
- migration 失败必须让部署失败。

## 8. Provider 与履约边界

第一阶段只建立 Provider Registry 的配置边界和禁用门禁，不执行真实购买。

Provider code：

- `IPIPD`
- `NINE_EIGHT_FIVE`
- `PROXY_SELLER`

Provider 规则：

- `STATUS` 只能是 `ACTIVE` 或 `DISABLED`，默认 `DISABLED`。
- baseUrl 必须做 SSRF 校验。
- credential 加密存储，不进入日志、OpenAPI、前端 bundle。
- Provider Adapter 从统一配置服务读取配置，页面、route、use case 不直接读 `process.env`。
- Provider 未启用时购买路径必须 fail closed。

## 9. 安全、审计、观测

### 9.1 安全

- APIKey hash 存储，只展示一次。
- 上游 APIKey、Provider 凭据、支付密钥加密存储。
- Admin 使用登录态 / HttpOnly session / 后端 RBAC。
- Web bundle 禁止注入系统 key、Provider secret、数据库连接。
- 钱包调整必须 reason + idempotencyKey。

### 9.2 审计

必须写审计：

- 登录安全事件。
- APIKey 签发、禁用、轮换。
- 钱包充值、扣款、调账、退款。
- platform admin 跨租户操作。
- impersonation。
- Provider credential rotate。
- 订单重试、退款、补单。

### 9.3 观测

- 所有请求有 requestId/traceId。
- 结构化日志。
- health：`/health`。
- readiness：`/ready`。
- OpenAPI：`/openapi.json`。
- Web health：`/healthz`。

## 10. 测试策略

### 10.1 测试分层

- Domain：金额、币种、权限判断、状态机、价格优先级。
- Use Case：充值确认、退款、购买、库存不足、价格缺失、上游失败。
- Repository：真实测试库验证查询语义。
- API：Supertest 覆盖 envelope、scope、tenant 边界。
- Frontend：Vitest + Testing Library 覆盖路由守卫、表单、错误态。
- E2E：Playwright 覆盖登录、充值、后台审计、后续购买成功/失败路径。

### 10.2 第一阶段必测

- USER 不能访问 `/system/*`。
- tenant admin 不能跨 tenant。
- platform admin 操作产生 audit log。
- DB 故障不能变成空列表或业务未配置。
- 非平台币种不能进入资金链路。
- 创建充值单不改钱包。
- 支付确认必须写 wallet + ledger + audit。

### 10.3 禁止测试

- 测 mock 调用次数冒充行为。
- snapshot 锁死大 UI。
- 为了通过测试放宽断言。
- memory mock DB 伪造成功。

## 11. 部署与发布

### 11.1 服务拓扑

| 服务 | 说明 | 健康检查 |
| --- | --- | --- |
| `web` | Public / Customer / Admin 前端 | `/healthz` |
| `api` | API / OpenAPI / Auth / Use Case | `/health`、`/ready` |
| `worker` | 履约、库存同步、回调补偿、异步审计 | `/health` |
| `postgres` | 主数据库 | 托管健康检查 |
| `redis` | 幂等、限流、队列、短期缓存 | 托管健康检查 |

### 11.2 环境变量边界

- API/Worker 可读取数据库、Redis、JWT、Provider、Payment、APIKey secret。
- Web 只读取公开配置。
- 生产强制 `ALLOW_PLACEHOLDER_APIKEYS=false`、`ALLOW_LOCAL_DEV_APIKEY=false`。
- `PROVIDER_FULFILLMENT_EXECUTION_ENABLED=true` 时必须配置 allowlist，否则启动失败。

### 11.3 发布门禁

每个 PR 至少运行：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

涉及 UI：

```bash
pnpm e2e
```

涉及 DB：

```bash
pnpm prisma migrate dev
pnpm test:integration
```

生产 smoke：

```bash
curl -fsS https://api.ipipx.365proxy.net/health
curl -fsS https://api.ipipx.365proxy.net/ready
curl -fsS https://ipipx.365proxy.net/healthz
curl -fsS https://api.ipipx.365proxy.net/openapi.json
```

## 12. 仓库骨架

蓝图批准后初始化推荐目录：

```txt
.
  docs/
    BLUEPRINT.md
    ARCH.md
  apps/
    api/
    web/
    worker/
  packages/
    db/
    contracts/
    config/
    eslint-config/
    tsconfig/
  prisma/
  scripts/
  .trellis/
    spec/
    tasks/
    workspace/
  docker-compose.yml
  package.json
  pnpm-workspace.yaml
  turbo.json
  .env.example
  .gitignore
  README.md
```

## 13. 风险与验证方式

| 风险 | 处理方式 | 验证 |
| --- | --- | --- |
| 第一阶段范围膨胀 | 代理购买和 Provider 履约延后 | Trellis task 拆分与评审 |
| 权限散落 | 统一 guard 和 AuthenticatedContext | API 权限测试 |
| 资金链路不一致 | wallet + ledger 事务化 | 充值确认集成测试 |
| 契约漂移 | OpenAPI 生成前端类型 | typecheck + API schema 测试 |
| 假数据混入 | 禁止 fallback/mock DB | 静态检索 + code review |
| 租户越权 | 查询默认 tenant 边界 | tenant admin 跨租户测试 |
| Provider 凭据泄露 | 配置服务 + secret 边界 | 日志脱敏测试 |
| 部署门禁后补 | 第一阶段就写 health/ready/env guard | build + smoke check |

## 14. 工具与执行备注

- 当前环境未暴露 fast-context 工具，蓝图阶段使用 `rg`、文件阅读和人工架构梳理替代。
- 当前环境 `rtk` 不可用，后续命令使用原生命令，并在验证报告记录。
- 当前目录尚未初始化 Git。Git、Trellis 和 worktree 必须在本蓝图批准后执行。

## 15. 下一步

用户批准本蓝图后，进入 Superpowers 第二步 `using-git-worktrees`：

1. 初始化 Git。
2. 写 `.gitignore`。
3. 初始化 Trellis。
4. 填充 `.trellis/spec/*`。
5. 创建开发 worktree。
6. 进入 `writing-plans`，把第一阶段拆成 2-5 分钟粒度任务。

如果用户要求调整，本阶段继续修改蓝图，不进入工程初始化。
