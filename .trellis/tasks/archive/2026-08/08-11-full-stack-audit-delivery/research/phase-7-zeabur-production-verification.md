# 线上部署验收记录（2026-08-12）

## 已验证

- Zeabur 目标项目为 `untitled`，生产环境已运行 PostgreSQL、Redis、API、Worker、Web 五个服务。
- API 服务 `/health` 与 `/ready` 返回 HTTP 200；`/ready` 的数据库和 Redis 检查均为成功。
- Worker 最新部署为 RUNNING，启动日志包含履约、库存同步、专线订单、Bark outbox、专线投影五类 worker。
- Web 临时端口转发入口 `http://43.172.85.117:30422` 的 `/healthz` 与首页返回 HTTP 200。
- 生产数据库已执行全部 17 个 Prisma migration。
- 管理员登录成功；当前站点为 `365Proxy`，状态 `ACTIVE`。
- 管理目录线上返回两个可见专线 SKU：`SV`（短视频）和 `ZB`（直播）。

## 有意保持关闭

- `DEDICATED_LINE_ORDER_EXECUTION_ENABLED=false`
- `DEDICATED_LINE_PROJECTION_EXECUTION_ENABLED=false`
- Provider fulfillment/inventory allowlist 为空
- `BARK_ALERTS_ENABLED=false`

这些开关在没有真实供应商凭据、节点白名单、OpenUI 投影回执和 NY 转发/DNS 验证前不得打开。

## 当前阻塞

1. 生产没有经用户确认的 SV/ZB 价格表；报价接口会因缺少 SKU price rule 返回 `no_sku_price_rule`。不得把测试夹具价格写入生产。
2. 现有 Zeabur `openui` 服务仍为 CRASHED，未建立可验收的 3x-ui/OpenUI 管理投影链路。
3. 985Proxy/IPIPD 生产凭据、库存同步、Hong Kong 3x-ui 节点和 NY 面板线路快照尚未完成 Secret 注入与真实 smoke test。
4. Web 当前只有临时端口转发，没有稳定自定义域名；该入口不可作为生产域名交付。

## 安全备注

用户曾在聊天中粘贴服务器密码、第三方 API key 和应用 secret。正式上线前必须全部轮换；本记录不保存任何 secret/token/password。

## 代码质量复核

- API typecheck、lint 通过。
- API Vitest 全量通过：72 个文件、413 个测试。
- Web typecheck、lint、production build 通过。
- Web 中此前受 Ant Design/jsdom 渲染时间影响的三个 spec 单独复核通过：15/15。
- Web 全量测试在提高超时后超过 6 分钟未完成，因此不作为全量通过证据；没有发现新的断言失败证据。
- `git diff --check` 通过；仅有 Windows 换行提示。

## 2026-08-12 后续部署与 OpenUI 修复

- API 与 Web 已重新部署到同一 Zeabur `untitled` 项目；API、Worker、Web、PostgreSQL、Redis 均保持 `RUNNING`。
- 新增平台管理员专线 SKU 定价接口与 `/admin/pricing` 页面，OpenAPI 与生成 TypeScript 契约已同步；生产价格仍未写入，避免把未经确认的数字当成真实销售价。
- Web 临时入口 `/healthz` 返回 HTTP 200；未携带凭据访问 `/api/pricing/dedicated-skus` 返回 `AUTH_REQUIRED`，证明定价接口没有匿名暴露。
- OpenUI 首次源码部署暴露了三个真实镜像问题：脚本执行位缺失、shell 脚本 CRLF、Zeabur 转发端口与 OpenUI 默认端口不一致。已在 OpenUI 工作树修复：Dockerfile 补 `chmod`，容器脚本和 Xray 构建脚本统一 LF，`OPENUI_WEB_PORT=8080` 与 `EXPOSE 8080` 对齐平台端口。
- OpenUI 最终部署状态为 `RUNNING`；临时转发到容器 `8080` 返回 HTTP 200，验证完成后已关闭临时端口转发。运行日志确认 Xray 已启动、Web server 监听 8080。
- OpenUI `go test ./...` 与 `go vet ./...` 通过；API 全量 Vitest 为 73 个文件 / 415 个测试通过；Web production build、typecheck、lint 通过；新增专线定价页面测试为 2 个测试通过。

## 仍然关闭的生产闸门

- `DEDICATED_LINE_ORDER_EXECUTION_ENABLED=false`
- `DEDICATED_LINE_PROJECTION_EXECUTION_ENABLED=false`
- Provider fulfillment/inventory allowlist 为空
- `BARK_ALERTS_ENABLED=false`

OpenUI 面板本身已可运行，但尚未完成用户确认的 3x-ui 节点注册、NY 转发快照、DNS/入口端口和真实供应商凭据 smoke test。因此当前仍不能声称 SV/ZB 已具备真实自动下单和交付能力。

## 2026-08-13 限制投影与生产重部署

### 部署结果

- 在不创建重复服务、不改执行开关的前提下，原地更新了现有 `api`、`worker`、`openui` 服务。
- 新 deployment 均为 `RUNNING`：API `6a7cd9e1408580a2d37ec926`、Worker `6a7cda2e0d41a78958bb698b`、OpenUI `6a7cda7a0d41a78958bb698f`。
- API 容器内 `/health` 返回 HTTP 200；`/ready` 返回 HTTP 200，PostgreSQL 与 Redis 检查均为 `ok=true`。
- Worker 正常启动五类循环，但订单、投影、履约、库存与 Bark 执行均因生产开关关闭而显式记录 `*_disabled`，没有误触发真实购买。
- OpenUI 运行日志确认 `open-ui 3.0.7` 监听 8080、定制 `Xray 26.5.9` 已启动；容器内六个 Geo 数据文件均非空，API 到 `http://openui:8080/` 私网访问返回 HTTP 200。

### 本轮数据面契约

- `dedicated_lines` 的 `uplinkLimitBps`、`downlinkLimitBps`、`maxConnections` 现随首次下单、重试、暂停/恢复、续费投影到 OpenUI client，并进入 desired hash。
- `Bps` 明确为 bytes/second，零值表示 OpenUI/Xray 边界不限制；持久化的非空连接限制必须为正数。
- 字段传递、JSON 安全范围和 OpenUI client 落库已有测试；这只能证明配置收敛，不能替代并发连接与持续吞吐压测。

### 验证证据

- API 投影聚焦测试：3 个文件、12 个测试通过。
- API `tsc --noEmit`、production build、`predeploy:check` 通过。
- OpenUI `go test ./...`、`go vet ./...`、管理投影聚焦测试和发布契约脚本通过。
- Windows 默认 `bash` 因 WSL2 虚拟磁盘挂载错误无法启动；同一发布脚本改用 Git for Windows Bash，并使用本机 MSYS2 Python 后通过。这是本机验证环境故障，不是发布断言失败。

### 生产 Source of Truth 盘点

只读统计结果：`service_skus=2`；`sku_price_rules=0`、`provider_accounts=0`、`inventory_snapshots=0`、`placement_policies=0`、`control_nodes=0`、`inbound_profiles=0`、`delivery_routes=0`、`dedicated_lines=0`。

因此当前是“代码与基础服务健康”，不是“真实下单链路就绪”。生产执行开关、provider/account allowlist、支付确认开关仍全部关闭，符合门控要求。

### 外部网络实况

- `test-sv-1.yisukj.top` 与 `test-zb-1.yisukj.top` 均解析到 `14.116.138.238`。
- `14.116.138.238:60701` 与 `:60702` TCP 可达；尚未完成 VLESS/VMess/MIXED 协议握手，TCP 开放不能冒充线路交付成功。
- 香港目标机 `91.149.237.33:22` 可建立 TCP，但 10 秒内没有 SSH server banner，超时发生在密钥认证前。当前无法在该主机安装或核验 3x-ui，需在服务商控制台检查 sshd、防火墙或上游过滤。

### 仍需满足的生产门控

1. 用户确认 SV/ZB 的销售价格、币种和期限规则，并写入 `sku_price_rules`。
2. 使用轮换后的 provider secret 创建账号，完成真实库存同步；不得使用已在聊天中暴露的长期密钥直接打开购买开关。
3. 修复香港 SSH banner，注册至少一个真实 `control_node`、`inbound_profile` 和 `placement_policy`，再做 OpenUI managed projection read-back。
4. 从 NY 面板导入每客户可独立迁移的真实 `delivery_routes`，并完成域名、入口端口到香港节点的协议级握手。
5. 配置 Bark device key 后验证库存不足事件；最后按 provider/account allowlist 逐项开启库存、投影和订单执行，禁止一次性全开。

## 2026-08-13 Worker 关闭态日志降噪

- 生产日志发现订单、投影、履约、库存和 Bark worker 在关闭时仍按轮询周期重复输出 `*_disabled`，会掩盖真实事件并增加日志成本。
- 五类 worker 现按进程各记录一次关闭状态，仍保持队列不扫描、执行开关不变。
- TDD RED 复现为 5 个测试失败（第二次 poll 日志计数为 2）；GREEN 后聚焦测试 5 个文件 / 18 个测试通过，worker 全量测试、typecheck、build 通过。
- Zeabur worker deployment `6a7d4fb9dae81554f1f894e1` 已为 `RUNNING`。运行日志跨越多个 5 秒轮询周期后，五个 `*_disabled` 各仅出现一次。

## 2026-08-13 Web 公网入口与站点域名 Source of Truth

### Web 同源代理

- Web 生成域名 `365proxy-untitled.zeabur.app` 已为 `PROVISIONED`，仅绑定 Web 服务；API、OpenUI、PostgreSQL、Redis 未暴露公网域名。
- 修复 `apps/web/serve.mjs` 的公开后端路由判定：除 `/api` 外，显式代理 `/openapi.json` 与 `/res_static/*`，同时保留 `/api-keys`、`/apiary`、`/res-static` 等 SPA 路由。
- RED：原测试在 `/openapi.json` 断言处失败；GREEN：`node --test serve.spec.mjs` 为 7/7，Web typecheck/build 通过。
- Web deployment `6a7d644246afbcef424c5a3c` 已为 `RUNNING`。公网验证：`/` 为 HTML 200，`/healthz` 为 JSON 200，`/openapi.json` 为 JSON 200，`POST /res_static/business` 到达 API 并按鉴权契约返回 JSON 401；该路由的 GET 404 是方法不支持，不是 SPA fallback。

### 站点公网域名控制

- 发现生产 `sites.domain` 仍为 `web.zeabur.internal`；公网 `/api/sites/current` 依赖首个 ACTIVE 站点兜底，不能作为多站点正确解析证据。
- 新增设计契约 `design/site-public-domain-control.md`、共享 DNS hostname 校验、`UpdateSiteDomainUseCase`、平台管理员 `PUT /api/sites/current/domain` 与无默认值的 `site:set-domain` SYSTEM 运维命令。
- 站点更新与 `site.domain.update` 审计在同一 PostgreSQL 事务中；站点 domain 唯一冲突与现有租户 `customDomain` 冲突均返回 `VALIDATION_ERROR/site_domain_taken`。
- 本地 RED/GREEN 后 4 个测试文件共 21/21 通过；锁定 TypeScript 5.7.2 的 `tsc --noEmit`、Nest build、OpenAPI export 通过。集成 spec 已加入，但本机没有 `DATABASE_URL_TEST`、本地 PostgreSQL 或可用 Docker daemon，测试在环境校验阶段失败且未进入业务断言；未将生产库用于会清库的集成测试。
- API deployment `6a7d6e0c46afbcef424c5f7f` 构建完成并上线；公网 OpenAPI path 数从 140 增至 141，包含 `PUT /api/sites/current/domain`。
- 在 API 容器内以显式 `SITE_CODE=MAIN`、公网域名和 `SYSTEM` actor 运行同一 use case。生产只读核对显示：`sites.domain=365proxy-untitled.zeabur.app`；最新审计 `actorType=SYSTEM`、`targetType=site`，meta 同时保存 previousDomain 与 newDomain。
- 公网 `/api/sites/current` 现返回 `MAIN` 和正确公网 domain；容器内 `/health`、`/ready` 均为 200，readiness 的 DB 与 Redis 检查均为 `ok=true`。

### 残余风险

- 租户 `customDomain` 仍存于 JSON，没有数据库唯一索引。站点更新已显式检查现有租户占用，但站点与租户并发写入仍不能获得跨两种存储形态的数据库级唯一保证；应在后续 schema 迁移中把租户域名提升为独立规范化列。
- 公网入口和控制面健康已验证，但 Provider、价格、节点、线路库存仍未配置，生产执行开关仍关闭；这些证据不代表真实专线订单或协议连通已经验收。

## 2026-08-13 每客户专线限额控制与生产部署

### 数据与权限契约

- `dedicated_lines.quotaBytes/uplinkLimitBps/downlinkLimitBps/maxConnections/ipLimit` 是限额 Source of Truth；0 表示不限。
- 新增管理端分页读取 `GET /api/admin/control-plane/lines`，统一返回 `{ page, pageSize, total, items }`。平台管理员按 site 读取，代理管理员额外按 tenant 隔离。
- 新增 `PUT /api/admin/control-plane/lines/:id/limits`。五项限制必须完整替换，`reason` 必填；变更、`desiredVersion + 1`、所有投影重置、逐节点 external job 和 `dedicated_line.limits.update` 审计在同一个 serializable transaction 中完成。
- 三项 PostgreSQL BigInt 在读取端返回十进制字符串。写入端限制为 `Number.MAX_SAFE_INTEGER`；历史越界值显式返回 `dedicated_line_limit_out_of_range`，不得静默舍入。
- 客户 `/dedicated-lines` 页面只读展示流量、上下行、连接数和 IP 数限制，不提供免费自助扩容。付费扩容仍需独立 SKU/报价/订单快照契约。

### 本地验证

- API 专线限额/交付单元测试：3 个文件、16 个测试通过，覆盖分页、site/tenant 权限、完整替换、幂等回放、终止态、投影任务、审计和 BigInt 精度。
- Web 管理控制平面及限额编辑：2 个文件、5 个测试通过；客户专线流程 4 个测试通过。
- API 与 Web 锁定 TypeScript 5.7.2 的 `tsc --noEmit` 通过；相关 API/Web ESLint 通过；Nest production build 与 Vite production build 通过。
- OpenAPI export 与 contracts generate 通过。线上 OpenAPI 明确包含分页响应 `DedicatedLineLimitPageDto`、请求 `UpdateDedicatedLineLimitsDto` 和响应 `DedicatedLineLimitsResultDto`。
- 本机没有 `DATABASE_URL_TEST`、可用本地 PostgreSQL 或 Docker daemon，因此没有把会清理数据的集成测试指向生产库；真实 PostgreSQL 集成断言仍是缺口。

### Zeabur 部署与公网冒烟

- API deployment `6a7d79c746afbcef424c65e6` 为 `RUNNING`；Web deployment `6a7d7b4446afbcef424c66ad` 为 `RUNNING`。
- 公网 `GET /openapi.json` 已出现两个限额路由及正确 schema。匿名 GET 列表和结构化 PUT 更新均返回 JSON 401、`AUTH_REQUIRED` 与 request ID，证明代理、路由、请求解析和鉴权边界已生效，且未写入生产业务数据。
- 线上 Web 主资源包含“专线客户限额”和 `/admin/control-plane`。真实 Chromium 在 1440x900 与 375x812 验证：首页 200；匿名访问 `/admin/control-plane` 正确跳转 `/admin/login`；匿名访问客户权威路径 `/dedicated-lines` 正确跳转 `/login`。
- 六个浏览器状态均无横向溢出、console error、page error 或 failed request。截图位于 `evidence/phase-7-line-limits/`。
- `/customer/dedicated-lines` 是源码目录带来的错误测试假设，不是公开路由；代码中的导航、购买成功出口和侧栏均使用权威 `/dedicated-lines`，无需增加兼容别名。

### 仍未验收

- 生产 `dedicated_lines=0`，且本轮没有使用或重置生产管理员/客户凭据，所以没有在线执行真实限额 mutation，也没有真实 line -> external job -> OpenUI read-back 证据。
- Provider account、价格规则、库存、control node、inbound profile、placement policy 和 delivery route 仍为空；订单、库存、投影、履约、Bark 和支付执行门继续关闭。
- 在用户确认价格、轮换并注入第三方 secret、修复香港 SSH、注册真实 OpenUI 节点及导入 NY 路由前，不得把本次部署描述成真实 SV/ZB 自动交付完成。
