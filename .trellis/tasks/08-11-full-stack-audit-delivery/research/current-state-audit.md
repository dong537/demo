# 当前代码事实审计

审计日期：2026-08-11（恢复快照后的本地工作树）

## 结论摘要

当前仓库是一个已经实现一部分资金、静态住宅代理交易和 Reseller UI 的控制面，
不是用户目标中的 365Proxy 专线控制平面。不能把现有 `proxy_instances`、
`platform_resources` 或静态 Provider Adapter 直接解释为 3x-ui/Xray 专线能力。

## 用户确认后的业务边界

- 首批客户商品是 `SV` 短视频专线和 `ZB` 直播专线，SKU 目录需要可扩展。
- 家宽/静态住宅是旧能力，必须从专线可售目录禁用或降级，不得作为库存不足时的 fallback。
- 985Proxy 的专线库存闸门使用 `SK5` 业务库存；本地库存不足时不得调用购买接口，并需要
  Bark 管理员告警。当前官方公开文档展示的是静态住宅 `shared`/`premium` 类型，尚未证明
  `SK5` 的请求字段和库存响应映射，必须通过真实账号或供应商确认后再落 Adapter，不能猜字段。
- 客户/SKU 可固定到指定 3x-ui 节点与线路；订单创建后不允许静默迁移。容量选择和迁移都要
  记录版本、操作者和审计。
- NY 面板负责平台外的预配置端口转发。365Proxy 只导入规则并保存多个域名别名、目标端口和
  版本，用于交付和切换；平台不写 NY。
- `C:\Users\Lenovo\Desktop\3xui\OpenUI` 是独立的 3x-ui/OpenUI 源码输入。其 SQLite、
  Token 和节点状态不能替代 365Proxy PostgreSQL Source of Truth。

### 阻断级缺口

1. Prisma schema 和后端模块中没有 3x-ui 节点、Inbound、Outbound、Route、节点组、
   desired/observed projection、专线实例、连接凭据、流量采集或出口分配模型。
2. `rg` 未找到真实的 `3x-ui`、`xray`、`inbound`、`outbound` 控制面 Adapter；现有
   `inbound` 文本仅出现在通用路由/文档语境，不能作为实现证据。
3. Reseller 只有租户、下级用户、钱包、模板、商品和订单查询接口，没有代理商自己的
   365Proxy 上游 APIKey 配置/探测/履约路由，也没有代理商代下单的控制面流程。

## 已实现模块与边界

### 资金、报价和静态订单

- `apps/api/src/modules/orders/use-cases/create-static-proxy-order.use-case.ts`
  在一个 PostgreSQL transaction 内完成钱包扣款、订单创建、履约任务创建和审计。
  使用站点/租户/用户/幂等键唯一约束，订单保存 `quoteSnapshot`。
- `apps/api/src/modules/pricing/pricing.repository.ts` 的价格候选优先级为：用户资源覆盖、
  用户绑定模板、租户默认模板、资源覆盖、站点默认模板，并检查币种。
- `apps/api/src/modules/fulfillment/use-cases/fulfill-static-proxy.use-case.ts` 读取
  `platform_resources` 和 `resource_mappings`，通过 IPIPD、985Proxy、PR 或通用上游
  Adapter 购买静态代理，AES-GCM 加密密码后写入 `proxy_instances`。
- Provider 层支持库存同步、购买、查询订单和部分续费/换密/切 IP；这些是住宅静态代理
  契约，不是 3x-ui 配置投影契约。

### 履约与资金风险

- `fulfill-static-proxy.use-case.ts` 对 `PENDING` 或空代理结果抛出
  `upstream_order_pending`；达到 `maxAttempts` 后直接给本地钱包退款并把订单标记为
  `FAILED`。该路径没有上游取消、退款确认或后续对账任务。
- `upstream_order_mirrors` 只有普通字段，没有看到按
  `providerCode + upstreamAccountId + upstreamOrderId` 的数据库唯一约束。进程在上游
  购买成功但镜像写入前崩溃时，重试是否能依赖 Provider 幂等性并未统一保证。
- IPIPD 把本地幂等键放入 `orderNo`；985Proxy 的请求构造没有把本地幂等键传入购买请求；
  PR 先 `order/make` 再 `resident/list/add`，两个外部副作用之间没有本地可恢复的 saga
  状态。不能假设所有 Adapter 都具有同样的幂等语义。

### Worker 并发与恢复

- `apps/worker/src/fulfillment-worker.ts` 每次 poll 顺序 `await` 每个 job，批量 10 单会
  放大到接近 10 倍单单延迟；`batchSize` 只是取数上限，不是受控并发。
- `fulfillment.repository.ts` 使用 `updateMany` 抢单，单行 claim 具有原子条件；但没有
  lease token/heartbeat。运行任务超过 10 分钟会被 `recoverStaleRunningJobs` 重新放回队列，
  可能与原 worker 并行执行。
- 没有 dead-letter/人工介入状态、上游取消/补偿状态机或订单/镜像对账 worker。

### 出口测活与地理一致性

- `CheckProxyUseCase` 只允许用户探测自己拥有的 `proxy_instances`，通过固定
  `PROXY_CHECK_TARGET_URL` 发起一次 HTTP/SOCKS5 请求，返回可达性、延迟和可选出口 IP，
  并写一条审计。
- 当前 prober 不解析国家/ASN/城市，不比较订单国家与真实出口国家，也不保存测活观测或
  freshness。没有“仅对已使用/待切换出口周期测活”的调度任务。
- 数据库没有 residential exit pool、出口健康状态、地理观测、分配/租约或切换历史模型。

### Reseller 与 API

- `CustomerResellerController/Repository` 提供 `/customer/reseller/me|overview|users|users/:id/wallet-adjust|orders|products|templates`，
  用 `requireOwnedTenant` 和 site/tenant 过滤保护边界。
- 代理商可创建下级用户、调账、设置商品和模板；下级用户仍通过普通用户订单路径下单。
  代理商没有自己的 365Proxy 上游账户绑定、余额/库存/价格检测或专用履约路由。
- `api_keys` 支持 `USER`、`TENANT_ADMIN` owner，明文只在创建响应返回、数据库存 hash；
  但现有 OpenAPI 仍复用静态代理接口，不能证明 Reseller 上游 APIKey 已成为订单 Source of Truth。
- 当前 Reseller 订单列表允许传任意 `userId`，虽有 `siteId + tenantId` 条件，但没有在
  repository 内显式验证该用户属于目标 tenant；应由集成测试覆盖越界查询与代操作。

### 数据库与部署

- `orders`、`fulfillment_jobs`、`upstream_order_mirrors`、`proxy_instances` 是静态代理交易
  聚合；没有专线订单项/节点 projection/版本/回滚/观察状态。
- 仓库有 `apps/api/Dockerfile`、`apps/web/Dockerfile` 和 Railway 配置；没有 Zeabur 专用
  manifest。根 `docker-compose.yml` 仅声明本地 PostgreSQL/Redis，不能作为 Zeabur 多服务
  部署证据。
- Dockerfile 构建会在容器内重新 `pnpm install --frozen-lockfile`，依赖安装和 Prisma
  generate 尚未在本地执行；当前工作树无提交、无远程备份。
- 代码没有发现入口连接数保护、Email 级冷却/封禁、分布式 API 限流或 Xray 数据面限速配置。

## 风险分级与建议落点

| 优先级 | 风险 | 需要的正确模块 |
| --- | --- | --- |
| P0 | 目标域不存在，继续在静态代理模型上堆字段会污染边界 | 新建 dedicated-line、exit-pool、node-control、topology 模块与 Prisma 聚合 |
| P0 | 上游 PENDING 失败后退款，可能产生外部成功/本地退款错账 | 上游订单 saga、状态对账、取消能力探测、人工补偿状态 |
| P0 | 缺少 3x-ui/Xray/NY 真适配器，无法验收专线连接 | 独立 Adapter + desired/observed reconcile worker |
| P1 | worker 顺序执行且无 lease heartbeat | 受控并发 claim、lease token、心跳、退避、DLQ/人工队列 |
| P1 | 出口只测可达性，不校验实际国家且无定时测活 | 出口观测、GeoIP provider、used/rotation 选择器、freshness |
| P1 | Reseller 没有上游 APIKey/余额/库存/价格和代下单链路 | reseller-upstream-account Adapter、tenant-scoped order facade |
| P1 | 无手工 SOCKS5 导入和到期/来源/状态模型 | exit import aggregate + validation + lifecycle worker |
| P1 | 无入口连接洪泛/Email 级限速防护 | edge/firewall policy + data-plane capability contract + telemetry |
| P1 | Zeabur 多服务入口与 migration/startup 未定义 | root/build-context 或显式 Dockerfile paths、api/worker/web service manifest |
| P2 | 文档仍以静态住宅代理为主 | 完成新域后迁移 blueprint/spec，删除失效路径 |

## 验证缺口

- 当前测试文件主要覆盖静态订单、钱包、Provider Adapter、Proxy UI 和权限；没有 3x-ui、
  NY、DNS、专线投影、出口国家校验、并发吞吐、洪泛或真实外部客户端测试。
- 集成测试依赖真实 PostgreSQL（`DATABASE_URL_TEST`），本机尚未安装依赖，不能把未运行的
  测试当作通过。
- 本审计是代码证据，不代表生产凭据、节点、DNS 或 Zeabur 资源已存在。

## 本地基线检查（2026-08-11）

- `pnpm install --frozen-lockfile`、Prisma client generate、`pnpm lint`、`pnpm typecheck` 和
  `pnpm build` 已通过。
- 根 `pnpm test` 冷启动时暴露 Turborepo 测试任务没有先构建 workspace 包的问题；手动构建
  `@ipeasy/db` 后，API 单测仍有 8 个失败，根因是两个测试夹具仍调用旧的站点/租户级 Provider
  配置，而生产实现已经按 `upstreamAccountId` 读取精确账号，属于契约测试漂移。
- Web API Key 流程聚焦测试为 6 通过、2 失败：一个断言把作用域标题和标签合并后的 4 个节点
  误期望为 2 个；另一个使用只返回翻译 key 的 `t` 夹具，却期望组件直接展示未知 reasonKey，
  而当前错误格式化契约会回退到通用 `error`。两项均需在隔离分支用测试先行修正，不应改生产
  错误语义来迎合夹具。
- 本地到用户提供的香港主机 `22/tcp` 连接超时；测试入口域名的 DNS/端口探测同样超时。因此
  当前环境没有外部 3x-ui、NY 或专线连接的可验证证据，不能宣称已安装、已部署或已连通。

## OpenUI / 3x-ui 源码审计（2026-08-11）

- 用户提供的独立工作树 `C:\Users\Lenovo\Desktop\3xui\OpenUI` 当前干净，位于 `main`，
  比 `origin/main` 领先 9 个本地提交。它不是 365Proxy monorepo 的子模块，二者必须经 HTTP
  Adapter 集成，不能共享 SQLite 或直接读取面板数据库。
- `rtk go test ./...` 通过：28 个包、123 项测试；`rtk go build ./...` 通过；`frontend` 的
  `npm run lint` 和 `npm run build` 通过。源码可以构建，但这不证明香港节点实际已安装或可访问。
- `web/runtime/remote.go` 使用 HTTPS、Bearer API Token、10 秒超时和 SSRF 保护调用
  `/panel/api/inbounds/list|add|update`，并有 read-back 流量快照；Token 列表实现一次性展示和
  预览脱敏。这满足 365Proxy node-control Adapter 的认证/读写基础，不替代 365Proxy 的
  desired/observed projection、租户隔离、订单幂等和审计。
- 前端构建存在 Vite `__dirname` 未来 native config loader 不兼容、翻译 JSON 静态与动态双重
  导入等 warning；不阻断当前构建，但在把 OpenUI 上线为受控节点前应单独处理。当前 OpenUI
  的 Zeabur 部署记录显示曾被策略拒绝，且无域名和线上 smoke test；3x-ui 应部署到用户控制的
  香港 Linux 节点，而不是将面板误部署成 Zeabur 应用。

### 自定义 Xray 限速/连接限制审计

- OpenUI release 固定构建 `helloandworlder/Xray-core` 的
  `openui-v26.5.9-rlimit.1` 标签。临时浅克隆解析到 commit
  `91f71c1ca4e4363b4e5de6cb970c6b5c585bb795`；相关 dispatcher 测试 7 项通过，HTTP/SOCKS
  配置测试 4 项通过。完整 `infra/conf` 测试有 1 项因临时克隆缺少 `geoip.dat` 失败，不能把
  聚焦测试扩大解释为全仓通过。
- `app/dispatcher/user_policy.go` 的 `rateLimiter` 以 bytes/s 工作，且在 `getLink`/`WrapLink`
  中为每条连接新建实例；它没有按 `inboundTag + Email` 共享 token bucket。结果是单连接近似
  限速，多连接总速率可接近 `连接数 * 单连接限速`，不满足“精准到 Inbound.Email 聚合”的要求。
- 每个新 limiter 的初始 burst 至少等于当前 MultiBuffer 大小，因此大量短连接会反复获得首包
  burst；现有测试只证明等待而非丢包，没有多连接聚合公平性、长连接 TCP 抖动、CPU/内存或
  低速率压力证据。
- `maxConnections` 的 registry 正确以 `inboundTag + Email` 为 key，并在 dispatcher 阶段拒绝
  超限连接；但它发生在协议鉴权后，无法替代防火墙/SYN backlog/conntrack 层的匿名洪泛保护，
  也没有 IP 冷却、Email 冷却或审计事件闭环。
- 通过一次性 Go 探针实际反序列化
  `{"uplinkLimitBps":1024,"downlinkLimitBps":2048,"maxConnections":3}` 到 VLESS/VMess 使用的
  `protocol.User`，三个值均为 0。原因是生成的 proto JSON tag 为 snake_case，而 OpenUI 面板
  对 VLESS/VMess 发送 camelCase；当前 HTTP/SOCKS 的专用 parser 才显式映射 camelCase。
  因此 VLESS/VMess 限速和连接限制在当前 release 中不生效，不能上线宣称该能力已完成。

## 下一步决策前提

在实现前必须确认现网 3x-ui/NY 面板是否有稳定的管理 API、TLS/认证方式、节点拓扑和自定义
Email 限速能力。若没有，应先以 stock 3x-ui API 做 Adapter/desired-state；Email 级“流量配额"
可以通过 Xray stats + 3x-ui 客户禁用闭环实现，而精确带宽 rate limit 需要独立数据面能力和
基准测试，不能伪称为 3x-ui 原生能力。

## 外部连通与部署复核（2026-08-11）

- 只读 DNS 解析显示 `sv-1.365proxy.net` 和 `zb-1.365proxy.net` 当前 CNAME 到
  `gtm.qifeikj.top`，并非目标拓扑中声明的 `cntcgz-lb.0ping.top` 与
  `cntcgz-lb-vip.0ping.top`。后两者当前分别解析为不同的腾讯云入口地址。该偏差必须在
  专线交付前由 DNS 权威配置或需求说明消除，不能把任一解析结果假定为设计已生效。
- 从当前审计环境探测，生产 SV/ZB 域名的 `50801/tcp` 可建立 TCP 连接；测试入口的
  `60701/tcp`、`60702/tcp` 不可达，香港 3x-ui 主机的 `22/tcp` 也不可达。该结果仅代表
  当前来源网络的可达性，可能受防火墙/白名单影响；不构成 3x-ui、NY 转发、认证、出口国家或
  专线数据面已验收的证据。
- 仓库存在 API/Web Dockerfile 和 Railway service 定义，但不存在 Zeabur manifest，Worker
  也没有 Dockerfile。根 `railway.json` 存在，而 `pnpm predeploy:check` 明确拒绝根
  `railway.json` 且要求工作树干净；当前恢复工作树没有任何 Git 基线提交、全部源码均未跟踪。
  因此项目当前不能通过自己的发布前检查，也没有可复现的 Zeabur 三服务部署定义。
- 当前环境变量契约未定义 Bark、专线投影 Worker 或 Zeabur 专用配置。不能仅通过把现有
  Railway 变量复制到 Zeabur 宣称专线控制面可运行；必须在专线模块和部署清单实现后补齐。

## 商城售卖面复核（2026-08-11）

- 现有 API 仍公开 `POST /api/orders/static-proxy` 及管理员代客下单路径，订单类型是
  `STATIC_PROXY_BUY`；客户前端仍通过 `BuyStaticProxyFeature` 发起该请求，管理员订单抽屉
  也复用相同静态代理下单契约。因此“旧家宽/静态住宅不可售”尚未实现，不能仅靠隐藏导航或
  把库存设为零来满足要求。
- 客户 UI 和 OpenAPI 默认 API key scope 仍以静态住宅代理为中心，公共页面、国际化文案、
  管理员仪表盘和 Reseller 订单页均对 `STATIC_PROXY_BUY` 有可见语义。专线 SKU 目录、
  交付链接、生命周期操作和上游 Reseller facade 尚不存在，改造必须移除旧购买 surface，
  而不是让两套用户可购买的产品模型长期并存。
- 现有 static order 模块可作为钱包扣款、不可变报价和审计模式的参考，但不得直接复用其
  Provider purchase -> `proxy_instances` 发货语义；专线需要独立 order item、exit assignment、
  node projection 和 delivery aggregate。
