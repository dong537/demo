# 官方集成边界研究

研究日期：2026-08-11。仅采用项目官方仓库/官方文档，结论用于 Adapter 和验收设计，
不代替真实版本、凭据和节点的线上 smoke test。

## 3x-ui

- [3x-ui 官方 Inbounds API 文档](https://github.com/MHSanaei/3x-ui/blob/main/docs/content/docs/en/reference/api/inbounds.mdx)
  说明接口位于 `/panel/api/inbounds`，需要登录 session 或 Bearer token；支持 list/get/add/del/update、
  enable、重置流量、导入和 client traffic push 等操作。Adapter 不能只保存 panel URL，必须保存
  认证方式、外部 inbound id、请求/响应脱敏审计和版本。
- [3x-ui 官方架构文档](https://github.com/MHSanaei/3x-ui/blob/main/docs/architecture.md)
  显示状态变更经 `runtime.Runtime` 分发到本机或远程子节点，并已有 node、inbound node sync、
  traffic merge、client apply 等服务概念。我们的控制面应把 desired state 与 observed state
  分开，不能把 3x-ui 的 SQLite/HTTP 返回直接当业务订单状态。
- [3x-ui 官方 Clients 文档](https://github.com/MHSanaei/3x-ui/blob/main/docs/content/docs/en/config/clients.mdx)
  说明 client 以唯一 Email 识别，支持 traffic/expiry/IP limit，达到流量或过期上限会禁用；IP
  限制依赖 Fail2ban。该能力适合“Email 累计流量配额 + 到期停用”闭环，但不证明有精确的
  上下行 bit/s 速率控制。
- [3x-ui 安装/安全说明](https://github.com/MHSanaei/3x-ui/wiki/Installation)
  说明 Fail2ban 的 IP 限制需要 `NET_ADMIN`/`NET_RAW` 和 iptables；容器/Zeabur 若不提供这些
  权限，不能宣称 3x-ui 原生 IP limit 已生效，必须采用边缘防火墙或独立数据面。

## Xray-core

- [Xray Statistics](https://xtls.github.io/en/config/stats.html) 规定用户流量统计键为
  `user>>>[email]>>>traffic>>>uplink/downlink`，且用户必须设置 Email；数据通过 Xray API
  StatsService 获取。控制面可按 email 聚合并写 usage projection，但要记录采集时间和节点。
- [Xray Policy](https://xtls.github.io/config/policy) 提供握手、连接空闲、上/下行关闭等待、
  用户流量统计和在线统计等本地策略；文档没有给出按 Email 精确带宽速率的原生字段。若需求
  是 bit/s 限速，必须另建数据面/内核扩展并用长连接、多并发基准证明误差和无断流。
- [Xray API](https://xtls.github.io/en/config/api.html) 是 gRPC API，可增删 inbound/outbound、
  增删用户、修改路由并查询 StatsService。它是数据面控制 seam；每次投影需幂等标识、回读
  校验和回滚/补偿，不能只调用 3x-ui UI 路由。

## Zeabur

- [Zeabur Dockerfile 部署](https://zeabur.com/docs/en-US/deploy/methods/dockerfile) 允许使用
  Dockerfile，要求服务暴露对应 `PORT`；monorepo 可按服务名匹配 Dockerfile 或使用
  `ZBPACK_DOCKERFILE_PATH` 指定子目录路径。当前仓库的 `apps/api/Dockerfile` 和
  `apps/web/Dockerfile` 可作为构建起点，但 worker 还没有 Dockerfile。
- 同一文档明确 Zeabur 不直接支持从 Docker Compose YAML 部署；根 `docker-compose.yml` 只能
  用作本地依赖，不能作为线上拓扑证据。API、web、worker、PostgreSQL、Redis 应拆成服务，
  逐项回读启动日志、端口、环境变量和 migration 状态。
- [Zeabur 部署总览](https://zeabur.com/docs/en-US/deploy) 说明项目内服务可包含应用和数据库，
  但域名、secret、startup order、持久卷和网络策略仍需在目标项目中逐项验证。

## 集成决策

1. 首选 stock 3x-ui 的明确 Adapter：面板 API 负责节点/Inbound/client 投影，Xray gRPC
   StatsService 负责流量观测。3x-ui 版本、API token、CSRF/TLS 和 child-node 方式必须成为
   node credential 的显式配置。
2. 业务订单 Source of Truth 放 PostgreSQL desired state；每个外部对象记录 node id、inbound
   tag、client email、external id、desired version、observed version、last error 和可回滚快照。
3. “每 Email 上下行限制”先拆成两个能力：累计 quota（Xray stats + disable client）与
   instantaneous rate（需独立数据面）。只有前者有官方文档直接支撑；后者在无真实实现和
   benchmark 前必须保持未完成状态。
4. Zeabur 部署先完成 api/web/worker 和 DB/Redis 的控制面 smoke test；3x-ui/NY/DNS/入口
   转发属于外部基础设施，不能因应用部署成功而标记为完成。

## 本地 OpenUI 版本差异与修订决策

用户提供的 `C:\Users\Lenovo\Desktop\3xui\OpenUI` 是独立的定制 3x-ui 分支，不等同于
stock 3x-ui。对当前 commit 的源码审计给出以下可执行边界：

1. `/panel/api` 的 Bearer Token 路由只注册 Inbound、Server、Node、Custom Geo 和备份能力。
   Inbound list/add/update、client 和流量快照可以直接进入 365Proxy Adapter。
2. Outbound 和 Route 没有订单级 Bearer API；`/panel/xray/update` 属于网页登录 + CSRF surface，
   会保存完整 Xray template。365Proxy 不得模拟网页登录或为一条订单覆盖整个模板，否则多订单
   并发和人工配置会互相丢失。
3. OpenUI 需要新增深模块 `ManagedLineProjectionService`（名称可调整）及 Bearer API：按稳定
   `projectionKey`/`desiredVersion` 原子 reconcile 受管 Inbound client、SOCKS outbound 和 route，
   仅操作带 365Proxy ownership tag 的配置，验证端口/tag 冲突后保存、应用、回读并返回 observed
   hash。删除只允许删除同 ownership 的对象；不得接受任意全局 Xray JSON。
4. 365Proxy PostgreSQL 仍是订单和 desired state Source of Truth；OpenUI SQLite 只保存面板运行
   投影。每次 reconcile 记录 node、external key、desired/observed version、config hash、应用结果
   和脱敏错误。部分成功必须回滚或进入可重试/人工处理状态，不能返回成功。
5. NY 端口转发不进入上述写 API。平台只导入 NY 已配置的 route/domain 快照，并把目标 3x-ui
   node/port 与受管 projection 绑定后做外部解析和 TCP/协议 smoke check。
6. 当前定制 Xray 的 rate limit 不能验收：VLESS/VMess camelCase 字段实测解析为 0；HTTP/SOCKS
   虽能解析，但 token bucket 为每连接实例而不是 `inboundTag + Email` 聚合。修复应在独立 Xray
   数据面计划中完成共享 limiter registry、bit/s 到 bytes/s 边界转换、生命周期清理、协议覆盖、
   公平性/长连接/多连接/CPU/内存基准；OpenUI 控制面只保存和下发明确单位的配置。

## OpenUI Phase 5 实现边界（2026-08-11）

用户提供的 `C:\Users\Lenovo\Desktop\3xui\OpenUI` 已在独立 worktree
`managed-line-projection` 实现并提交 `a923190c`。本次实现确认以下接口契约：

- Bearer API 为 `GET/PUT/DELETE /panel/api/managed-line-projections/:projectionKey`。
  PUT body 是 `desiredVersion`、已有 `inboundTag`/`protocol`、客户凭据、SOCKS5 出口和生命周期；
  不接收整份 Xray JSON。响应只返回 projection key、版本、哈希、owned tags、状态和脱敏错误。
- 支持 VLESS、VMess、mixed；VLESS/VMess ID 必须是 UUID，mixed 必须提供 user/password。出口
  只生成带确定 ownership tag 的 SOCKS outbound；规则按客户 Email + 入站 tag 匹配。
- SQLite 新表只保存本节点的 runtime projection。365Proxy PostgreSQL 仍拥有订单、线路和 desired
  state；中心 Adapter 必须保存 node、projection key、desired/observed version、hash 和错误状态，
  不能把 OpenUI SQLite 返回当成业务订单成功。
- Xray gRPC 可增删 outbound，但 `RoutingService.AddRule(shouldAppend=false)` 会替换完整规则表；
  为保护人工规则，OpenUI 采用 DB 投影 + authoritative config merge + Xray restart + gRPC read-back。
  受管规则在既有规则前置，重启后从 ACTIVE/APPLYING 投影恢复。版本/hash 幂等和冲突保护已覆盖。
- reconcile 失败会补偿入站 settings、client traffic 和旧 projection；补偿失败进入 `NEEDS_OPERATOR`。
  删除只删除 exact ownership 对象。`enabled=false` 保留 desired 客户但不要求运行时用户读回，禁用
  目标入站则拒绝。

OpenUI `go test ./...`、`go vet ./...`、API docs route check 已通过；尚未运行真实 3x-ui/Xray 节点
或线上 SOCKS5 协议 smoke。前端 `npm ci` 因 registry 网络超时未完成，Go embed 使用已有 `web/dist`。
