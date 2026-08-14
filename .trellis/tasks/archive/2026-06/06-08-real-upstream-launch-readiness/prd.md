# 真实上游上线验收

## Goal

在第一版不接真实在线支付的前提下，完成静态住宅代理上线前验收：只走后台人工充值/虚拟余额，用真实 PR / IPIPD / 985Proxy 上游凭据验证资源同步、库存、报价、真实下单、真实履约、失败回滚，并确认上线所需运营项、观测项和回滚方案。

## Product Decision

- 第一版支付范围：后台人工充值 + 虚拟余额。
- 明确不接：支付宝、易支付、自动充值回调、支付对账自动化。
- 上线主线：真实上游凭据 + 真实资源/库存/报价/下单/履约 + 钱包扣款/失败退款 + 审计可追踪。
- 目标部署环境：Railway `ipipx-platform-live-20260526` / `production`，复用旧项目 `C:\Users\Lenovo\Desktop\家宽代理平台` 的 Railway 项目、服务命名和环境变量形状作为参考，但当前仓库必须按 pnpm/turbo 工作区重新配置。
- Railway 服务边界：`backend` 运行 API，`frontend` 运行 Vite 前端，新增/确认 `worker` 运行真实履约队列；Postgres 使用 Railway 托管数据库，Redis 使用 Railway 变量中的真实地址。

## What I Already Know

- 现有脚本：
  - `pnpm --filter @ipeasy/api seed:site`
  - `pnpm --filter @ipeasy/api seed:pricing`
  - `pnpm --filter @ipeasy/api provider:set-credential`
  - `pnpm --filter @ipeasy/api providers:health-check`
  - `pnpm --filter @ipeasy/api providers:sync-inventory`
  - `pnpm --filter @ipeasy/api providers:test-buy`
- `provider:set-credential` 优先从 `PROVIDER_CREDENTIAL_JSON` 读取密钥，避免进入 shell history。
- `providers:test-buy` 默认 dry-run；真实购买需要同时传 `--execute`/`--no-dry-run` 和 `--confirm`。
- `providers:sync-inventory` 上游失败会抛错，不写假库存。
- `AdjustWalletUseCase` 已支持后台人工充值/扣款，要求 `reason` + `idempotencyKey`，并写 `wallet.adjust` 审计。
- 已有 predeploy smoke 覆盖 `/health`、`/ready`、`/openapi.json`、登录、代客下单、钱包扣款、订单列表、审计日志。
- 旧项目 Railway 配置为 Nixpacks + backend `/health` + frontend `/healthz`，但命令使用 npm workspace；当前项目是 pnpm workspace，不能直接复制旧命令。
- 当前前端 API client 只请求相对路径；如果 Railway `frontend` 和 `backend` 分域部署，必须支持 `VITE_API_BASE_URL` 并在 API 启用显式 CORS。
- 当前订单创建后只写入 `fulfillment_jobs`；上线真实履约前必须有可部署的 worker 进程轮询队列并调用 `FulfillStaticProxyUseCase`。

## Requirements

- 部署前确认生产/预发环境只启用虚拟余额路径：
  - `PAYMENT_CONFIRMATION_ENABLED=false`
  - 不导入真实支付渠道开关或支付回调能力。
- Railway 配置必须满足：
  - backend build/start/pre-deploy 使用当前 pnpm workspace 命令。
  - backend pre-deploy 只运行 Prisma migrate，不做需要持久化文件系统的操作。
  - frontend 启动命令监听 Railway 注入的 `PORT`，并提供 `/healthz`。
  - worker 独立进程启动后只处理到期 `QUEUED` / `RETRYING` 履约任务，不暴露客户流量。
  - `.railwayignore` 排除本地 env、dist、coverage、临时文件和日志。
- 生产跨域/API 地址必须明确：
  - `frontend` 配置 `VITE_API_BASE_URL=https://backend-production-43893.up.railway.app` 或最终 API 域名。
  - `backend` 配置 `CORS_ORIGINS` 为 frontend 域名清单；不得用静默 fallback 掩盖跨域失败。
- 创建或确认管理员账号：
  - 至少一个 `PLATFORM_ADMIN`。
  - 如上线给代理商运营，至少一个 `TENANT_ADMIN`。
  - 密码不写入仓库、日志、PRD、聊天记录。
- 写入真实上游凭据：
  - `PR`
  - `IPIPD`
  - `NINE_EIGHT_FIVE`
  - 密钥通过 `PROVIDER_CREDENTIAL_JSON` 环境变量注入。
  - provider account 必须是 `ACTIVE`，并按需开启 `--inventory-sync`。
- 对每个真实上游执行健康检查。
- 对每个真实上游执行库存同步，并确认：
  - 真实资源写入 `platform_resources`。
  - 真实库存写入 `inventory_snapshots`。
  - 不可售资源不会参与报价/下单。
- 配置价格模板：
  - 至少一个默认价格模板。
  - 所有准备上线销售的资源覆盖 30/60/90 天价格。
  - 价格币种与平台币种一致，默认 `CNY`。
- 确认资源可售状态：
  - `status=ACTIVE`
  - `isSaleable=true`
  - 有库存快照。
  - 有对应价格规则。
  - 有履约所需 `resource_mappings` / `providerResourceId`。
- 用后台人工充值给测试客户充值，确认：
  - 钱包余额增加。
  - `ledger_entries` 写入。
  - `wallet.adjust` 审计写入。
- 对 PR / IPIPD / 985Proxy 分别跑：
  - 资源同步。
  - 库存检查。
  - 报价。
  - dry-run 下单请求预览。
  - 小数量真实测试购买。
  - 平台订单履约完成，生成代理实例。
  - 代理实例可在用户端复制/导出。
- 真实履约 worker 验收：
  - worker 能扫描 `QUEUED` / `RETRYING` 任务。
  - 同一任务只允许一个 worker 实例 claim。
  - 成功履约写 `upstream_order_mirrors`、`proxy_instances`、订单完成和任务完成。
  - 达到最大重试后写失败、退款和审计。
- 失败回滚验证：
  - 上游失败或履约失败不能生成假代理。
  - 达到最大重试后订单进入失败状态。
  - 钱包自动退款。
  - 账本、订单失败原因、审计日志可查。
- 错误告警与日志查看：
  - `/ready` 能暴露 DB/Redis 健康。
  - 上游健康检查结果可见。
  - 上游请求日志可查且不泄漏密钥/代理密码。
  - 审计日志可查关键操作。
- 回滚方案：
  - 可关闭单个 provider account。
  - 可关闭真实履约执行门禁/allowlist。
  - 可回滚 web/api 服务版本。
  - 支付事故时无需处理自动支付，只需停用人工确认入口或后台账号。

## Acceptance Criteria

- [ ] 生产/预发环境 `PAYMENT_CONFIRMATION_ENABLED=false`，只走后台人工充值/虚拟余额。
- [ ] Railway backend/frontend/worker 配置写入当前仓库，命令匹配 pnpm/turbo 工作区。
- [ ] frontend 能通过 `VITE_API_BASE_URL` 调用 Railway backend，backend CORS 只放行目标 frontend 域名。
- [ ] worker 在 Railway 可部署并能自动处理真实履约队列。
- [ ] 管理员账号可登录，权限符合平台/租户边界。
- [ ] PR / IPIPD / 985Proxy 真实凭据均已写入且不泄漏明文。
- [ ] 三个 provider health check 通过，失败时输出可执行原因。
- [ ] 三个 provider inventory sync 通过，库存来自真实上游。
- [ ] 可售资源均有价格、库存、映射和可售状态。
- [ ] 人工充值写 wallet + ledger + audit。
- [ ] 三个 provider 至少各完成一次小数量真实测试购买。
- [ ] 真实购买产生 order、fulfillment job、upstream mirror、proxy instance。
- [ ] 履约失败路径验证自动退款和审计。
- [ ] 部署前 smoke 在目标环境通过：`/health`、`/ready`、OpenAPI、登录、代客下单、钱包扣款、订单列表、审计日志。
- [ ] Runbook 记录所有命令、环境变量名、成功证据、失败处理、回滚步骤，不记录 secret。

## Definition of Done

- 上线验收 runbook 写入仓库或 Trellis task。
- 真实上游验收结果写入 task `info.md` 或专门的 launch report。
- 所有验证命令有最新执行结果。
- 生产/预发 smoke 通过。
- 工作提交完成，任务归档。

## Technical Approach

1. 先把上线验收 runbook 固化成脚本化步骤，不直接在聊天里散跑危险命令。
2. 使用现有 provider CLI 写凭据、健康检查、库存同步、测试购买。
3. 使用现有 Admin UI/API 做人工充值、代客下单、订单/审计检查。
4. 对真实购买采用小数量、allowlist、二次确认。
5. 所有输出只记录 provider/account/site/tenant/status/latency/orderId，不记录 secret、代理密码、完整 APIKey。

## Out of Scope

- 不接支付宝/易支付/自动支付回调。
- 不新增真实支付渠道签名验证。
- 不做大规模压测。
- 不做动态住宅代理生产化。
- 不把真实上游密钥写入文档、提交、测试快照或聊天记录。

## Technical Notes

- Existing provider ops scripts already enforce no-secret output and double-confirm real purchase.
- Production/provider execution gates must be checked before enabling real fulfillment:
  - `PROVIDER_FULFILLMENT_EXECUTION_ENABLED`
  - `PROVIDER_FULFILLMENT_PROVIDER_ALLOWLIST`
  - `PROVIDER_FULFILLMENT_UPSTREAM_ACCOUNT_ALLOWLIST`
- `.env.example` currently defaults provider execution gates to disabled.
- Railway CLI is authenticated and the old reference directory is linked to project `ipipx-platform-live-20260526` in environment `production`.
- Old Railway services observed: `frontend` at `https://frontend-production-9279.up.railway.app`, `backend` at `https://backend-production-43893.up.railway.app`, and `Postgres`.
