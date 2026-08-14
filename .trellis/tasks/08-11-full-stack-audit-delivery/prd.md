# 365Proxy 全项目审计与全链路交付

## Goal

将当前已恢复的 `ipeasy-platform` monorepo 收敛为可生产运行的 365Proxy 与
365Proxy-Reseller 双平台。平台以多家住宅 SOCKS5 Provider 提供出口资源，以多台
3x-ui/Xray 节点提供专线入口和路由控制，形成从充值、报价、下单、出口匹配、节点配置、
交付、续费和运维到审计的真实闭环，并最终部署到 Zeabur 完成线上全链路验证。

## Confirmed Business Decisions (2026-08-11)

本节是用户补充信息对原始审计目标的权威修订，优先于旧的“静态家宽交易”措辞。

- 365Proxy 当前售卖对象是跨境专线 SKU，首批 SKU 为 `SV`（短视频）和 `ZB`（直播）。
  SKU 必须是可扩展目录实体，不能把业务类型硬编码成 Provider 枚举。
- 现有“家宽/静态住宅”售卖能力彻底禁用或降级为不可售历史数据；它不能出现在客户可购买
  目录，也不能作为专线库存不足时的自动替代品。
- 985Proxy 只用于专线出口库存。专线下单前必须读取本地最近一次成功同步的 `SK5` 库存，
  按 SKU、国家/地区和数量做硬闸门；闸门不足时禁止调用 985Proxy 购买接口，并发送带幂等键的
  Bark 管理员告警。生产 APIKey、ZoneID 和 IPIPD 凭据只能来自 secret store/受控环境变量。
- IPIPD 可先接入 sandbox 再切换 production，但两种环境必须是显式 Provider 账号，不能在运行时
  用默认 URL 或隐式 fallback 混用。
- 3x-ui 节点是平台控制面的一部分。平台按客户、SKU、容量和管理员策略把订单固定分配到某个
  3x-ui 节点/线路；订单创建后的节点归属不可静默改变。迁移必须是显式操作、带新版本和审计。
- NY 面板和入口转发不在 365Proxy 控制面内。NY 侧提前配置好的转发规则通过导入进入平台，
  平台保存导入快照、有效期、目标节点/端口和多个域名别名，并负责展示、校验和客户交付；平台
  不直接写 NY 配置，也不把本地快照冒充 NY 的实时 Source of Truth。
- 每条可交付线路必须支持多个域名别名。域名切换/迁移只更新交付投影和显式线路版本，保留旧
  别名的撤销记录，避免单域名故障或单客户迁移时改动其他客户。
- 用户提供的香港 3x-ui 主机与本地 `C:\Users\Lenovo\Desktop\3xui\OpenUI` 源码是部署/能力
  输入，不属于 365Proxy 数据库。面板源码中的 SQLite、Token、节点状态不能越过 Adapter 成为
  订单 Source of Truth。

## Users

- 终端客户：注册登录、充值、购买专线、查看交付链接、续费、扩容、限速和工单。
- 平台管理员：管理客户、资金、Provider、出口池、3x-ui 节点、价格、订单、履约、客服和审计。
- 代理商：在 Reseller 平台配置 365Proxy APIKey、管理下级客户、定价、充值和订单。
- 代理商下级客户：在租户边界内充值、下单和管理自己的专线，但不能看到上游出口凭据。
- 客服与运维：处理工单、履约异常、节点故障、攻击事件、出口测活和人工补偿。

## What I Already Know

- 代码已从 Railway 历史 deployment 的完整源码快照恢复；当前本地 Git 已初始化但尚无基线提交。
- 技术栈为 pnpm workspace + Turborepo、NestJS/Fastify、Prisma/PostgreSQL、React/Vite、
  TanStack Router/Query、Ant Design、独立 worker。
- 现有 schema 已覆盖站点、租户、用户、APIKey、钱包、账本、充值单、Provider、资源、库存、
  价格、订单、履约任务、上游订单镜像、代理实例、工单和通知。
- 后端已有 IPIPD、985Proxy、PR Provider Adapter，以及静态代理订单、履约、库存同步和代理测活。
- 前端已有用户与管理员 surface，包含钱包、订单、代理、价格、Provider、租户、工单等页面。
- 当前代码和 schema 中未发现 3x-ui/Xray 控制面 Adapter、节点/节点组、Inbound/Outbound/Route
  投影、专线生命周期、流量扩容、用户级限速或多节点编排模型。
- 当前 `ProxyInstance` 仍是静态代理交付镜像；不能直接充当 3x-ui 专线 Source of Truth。
- 原始 `docs/BLUEPRINT.md` 和根 `PRD.md` 主要面向静态住宅代理交易，需要以本任务 PRD
  补充并迁移到 3x-ui 驱动专线域。
- `fast-context` 在当前工具集中不可用；项目探索使用 `rg`、目录树、schema 和调用链阅读替代。

## Requirements

### A. 365Proxy 主平台

1. 用户面板与管理员面板必须覆盖真实业务流程，不允许假按钮、假库存、假交付或生产 Mock。
2. 用户支持余额充值、提交充值申请、管理员人工确认充值和管理员直接调账；所有资金变化写入账本和审计。
3. 用户下单专线时必须完成：报价 -> 余额校验/扣款 -> 出口资源匹配 -> 3x-ui 配置 ->
   交付 -> 展示连接链接。任一步失败均进入明确、可重试或可退款的状态，不得伪装成功。
4. 出口匹配必须确保 SOCKS5 实际出口国家与订单国家一致；仅对已被专线使用或待切换的出口做定期测活。
5. 支持 IPIPD、985Proxy SK5、批量导入 SOCKS5，并为手工导入资源记录到期时间、来源和状态；
   家宽资源不进入专线可售池。
6. 支持全局价格覆盖、用户价格覆盖、价格模板及模板绑定；订单保存不可变报价快照。
7. 专线生命周期支持开关、续费、增加流量、限速、切换出口、批量导出和批量续费。
8. 用户可创建 API 凭据、查看余额/库存/价格/订单并调用兼容分销平台的 OpenAPI；APIKey 只展示一次并仅存 hash。
9. 工单与客服系统由平台统一管理，所有站点和代理下级客户看到同一套可配置客服入口。
10. 仪表盘必须展示来自真实账本、订单、库存、节点和履约状态的统计。

### B. 3x-ui/Xray 控制面与高可用

1. 支持多台 3x-ui，节点按入口组和出口能力分组，并记录区域、协议、容量、健康和凭据；
   订单可按客户/SKU 固定到指定节点，批量订单按容量策略分配以避免超载。
2. 每个节点上的 Inbound、Outbound、Route 配置必须可追踪、幂等和可回滚；订单节点归属和
   线路版本必须可审计，禁止 silent failover。
3. 入口支持 VLESS、VMess 和 mixed 等实际启用协议；出口为匹配国家的住宅 SOCKS5。
4. NY 面板只作为外部转发配置来源。平台支持管理员导入 NY 已配置的端口转发规则，记录
   目标 3x-ui 节点、端口、协议、状态和导入版本；不直接修改 NY。
5. 域名拓扑需要纳入可验证配置，并支持每条线路多个别名；DNS 解析结果只作为外部观测，
   不冒充平台本地配置已生效。
6. 批量下单不能按单串行放大到 `N * 单单耗时`；任务队列需要有受控并发、幂等、重试、隔离和补偿。
7. 上下行限速必须精确到 Inbound Email/客户连接身份，不因限速导致 TCP 断流或明显卡死。
8. 对连接数攻击提供分层保护：防火墙/入口限连接、用户 Email 级冷却、异常 IP 封禁、连接池保护和审计。
9. Xray core 魔改属于独立数据面组件；是否需要修改必须由基准测试和原生能力缺口证明，不能直接在控制面仓库内临时打补丁。

### C. 365Proxy-Reseller

1. 管理员可配置自由注册或仅管理员创建账号。
2. 代理商登录后配置其 365Proxy APIKey，显式检测上游余额、库存和价格，并保存加密凭据。
3. 代理商拥有租户级全局价格、价格模板、下级客户价格覆盖、客户充值、订单和统计。
4. 代理商下级客户可登录、充值和下单专线，订单通过该代理商的上游 APIKey 履约。
5. 代理商不得看到下级客户使用的住宅 SOCKS5 凭据或完整专线连接密钥；客服由平台统一承接。
6. 支持批量导出、批量续费和完整专线生命周期，所有读写严格受 tenant/site 边界约束。

### D. 工程、部署与持续巡检

1. 统一 API envelope、错误码、分页、金额精度、UTC 时间、request/trace ID 和审计字段。
2. 关键行为需要真实测试：资金幂等、报价、订单状态机、Provider、出口匹配、3x-ui 投影、
   多节点补偿、权限隔离和生命周期操作。
3. 本地完成 install、Prisma generate、lint、typecheck、unit/integration test、build 和适用 E2E。
4. 部署到 Zeabur 后验证 API、Web、worker、PostgreSQL、Redis、迁移、健康检查、域名和环境变量。
5. 线上 smoke test 必须覆盖充值、报价、下单、3x-ui 配置、交付链接、真实连接、续费和停用。
6. 专线通畅验收必须从外部客户端发起连接，验证认证、目标可达、出口国家、稳定性和限速行为。
7. 持续巡检输出可追踪问题清单；失败不能吞掉或转换为空数据/成功状态。

## Source of Truth

| Domain | Owner / Source of Truth | Read / Write Path |
| --- | --- | --- |
| 用户、站点、租户、权限 | PostgreSQL + 后端 Auth/RBAC | Controller -> use case -> repository -> audit |
| 钱包与余额 | `wallets` + immutable `ledger_entries` | 事务内支付/调账 use case；UI 不计算余额 |
| 充值申请 | `payment_orders` | 用户创建；管理员/支付回调幂等确认 |
| Provider 账号与凭据 | `provider_accounts` 加密字段 | Provider credential service -> Adapter |
| 出口资源 | 新增 residential exit/pool 模型 | Provider sync/import -> matcher -> probe -> assignment |
| 价格 | price rule/template/override + quote snapshot | pricing use case -> order snapshot |
| 专线订单 | 扩展后的 `orders` / order items | order use case -> fulfillment orchestration |
| 专线实例 | 新增 dedicated line aggregate | lifecycle use case -> projections -> delivery view |
| 3x-ui 节点配置 | 本地 desired state + per-node projection | orchestrator -> 3x-ui Adapter -> observed state |
| NY 转发配置 | NY 面板；平台保存导入快照 | 管理员导入/校验 -> 本地 delivery route view；平台不写 NY |
| 运行流量/限速 | Xray/3x-ui observed metrics | telemetry collector -> usage ledger/status projection |
| 工单与客服 | `tickets` / `ticket_messages` + site config | customer/admin use cases |
| DNS | DNS provider authoritative zone | IaC/config -> DNS provider -> external resolution check |
| 部署配置 | Zeabur service config + secret store | deployment manifests/CLI -> Zeabur read-back |

## Module Boundaries

- Domain/use case：资金、价格、订单、专线、出口分配、节点投影、生命周期和补偿状态机。
- Repository：只负责 PostgreSQL/Redis 持久化，不把 infra error 伪装成业务空值。
- Adapter：IPIPD、985Proxy、手工导入、3x-ui、NY、DNS、Zeabur；外部错误统一映射并记录脱敏日志。
- Worker：库存同步、出口测活、履约编排、节点投影、补偿、生命周期调度和指标采集。
- API：认证、DTO 校验、use case 编排、统一 envelope；不内嵌业务状态机。
- UI：server state/form state/client state 分离；页面只编排 feature module，不直接拼 Provider/3x-ui 请求。

## Interface Contracts

- 所有写操作携带幂等键；批量请求每项返回独立结果和稳定错误码。
- 金额使用 decimal string，流量使用明确字节单位；控制面 `uplinkLimitBps` /
  `downlinkLimitBps` 与 OpenUI/Xray 的实现单位是 bytes/second。产品若以 bit/s 展示，
  必须在 API/UI 边界显式乘除 8，禁止同一字段混用两种单位。时间使用 ISO 8601 UTC。
- 专线状态至少区分 `PENDING_PAYMENT`、`QUEUED`、`PROVISIONING`、`ACTIVE`、
  `DEGRADED`、`SUSPENDED`、`EXPIRED`、`CANCELLING`、`CANCELLED`、`FAILED`。
- 节点投影记录 desired version、observed version、last error、retry count 和 node-specific external ID。
- Provider/3x-ui/NY 调用记录 request ID、外部对象 ID、耗时、结果和脱敏错误，不记录明文凭据。
- 列表统一 `{ page, pageSize, total, items }`；权限错误、库存不足、价格缺失、节点不可用不能共用空数组语义。

## End-to-End Data Flow

```text
Provider sync/import -> exit resource store -> health/geo observation -> eligible exit pool
Customer quote -> pricing rules -> immutable quote snapshot
Recharge/payment/admin adjustment -> wallet + ledger + audit
Order submit -> transaction: wallet debit + order + fulfillment job
Worker claim -> exit matcher -> dedicated-line desired state
  -> imported NY delivery route lookup (no NY write)
  -> assigned 3x-ui node projections (Inbound/Outbound/Route)
  -> observed-state verification
  -> encrypted delivery credential/link -> ACTIVE
Lifecycle action -> desired-state version -> parallel node reconcile -> observed state -> audit
Telemetry/probe -> usage/health -> UI/API server state -> alert/repair/exit switch
```

## Acceptance Criteria

### Audit and architecture gate

- [ ] 现有功能矩阵逐项关联到 schema、public interface、实现、测试和 UI；目录名不能作为完成证据。
- [ ] 3x-ui、NY、DNS、Provider、订单、资金和租户边界都有明确 Source of Truth 和 Adapter 契约。
- [ ] 所有当前缺口、冲突文档、生产风险和验证阻塞写入研究/审计文档。

### Core platform

- [ ] 用户和管理员可完成真实充值/调账，余额与账本一致且幂等。
- [ ] 报价正确应用全局、模板和用户覆盖，并保存订单报价快照。
- [ ] 下单后只选择国家匹配且健康的出口，并生成真实履约任务。
- [ ] 3x-ui 多节点配置可并发、幂等、重试、回滚；部分失败不会误报 ACTIVE。
- [ ] 成功订单可展示并复制真实连接；失败订单可处理、补偿或退款。
- [ ] 开关、续费、流量增加、限速、切换出口和到期处理穿过同一生命周期 interface。
- [ ] 工单与客服对主站和 Reseller 下级客户可用且权限隔离。

### Reseller

- [ ] 注册策略可配置；代理商和下级客户身份、数据、价格、钱包和订单严格隔离。
- [ ] 代理商配置 365Proxy APIKey 后可真实读取余额、库存和价格。
- [ ] 代理商不能读取下级客户的 SOCKS5 凭据或完整专线密钥。
- [ ] 下级客户可完成充值、下单、交付、续费和批量操作。

### Performance, resilience and security

- [ ] 批量 10 单的调度不是纯串行 10 倍耗时，并有受控并发/背压指标。
- [ ] 多节点/Provider 故障、超时、重复消息、进程重启和部分成功均有测试和补偿证据。
- [ ] 用户级上下行限速达到目标误差范围，长连接无异常重置，CPU/内存开销通过基准测试。
- [ ] 连接洪泛测试证明入口连接限制、冷却、封禁和恢复策略有效。
- [ ] 凭据加密、APIKey hash、日志脱敏、权限和高危操作审计通过安全检查。

### Deployment and online verification

- [ ] Zeabur 所有服务部署成功且 migration、startup order、port、health check 和域名正确。
- [ ] 外部 DNS 查询符合入口拓扑配置。
- [ ] 线上真实账号完成充值 -> 下单 -> 3x-ui -> 连接 -> 出口国家验证 -> 生命周期操作。
- [ ] 线上浏览器验证用户/管理员/Reseller 核心页面的 loading、empty、error、permission 和成功状态。
- [ ] 线上问题和残余风险有可执行处理计划，不以“未发现错误”替代证据。

## Definition of Done

- 完整目标逐项有代码、测试或线上观测证据；未知和间接证据一律不算完成。
- lint、typecheck、unit/integration tests、build 和适用 E2E 通过。
- 真实 3x-ui、Provider、Zeabur 和外部客户端 smoke test 通过。
- 数据迁移、回滚、部署、监控、告警和故障处置文档完成。
- Trellis task/spec/workspace 已记录关键决策、检查结果和残余风险。
- Git 提交清晰，恢复基线与后续功能提交可审计，并有远程私有仓库备份。

## Assumptions (Temporary)

- 当前仓库继续作为控制面 monorepo；Xray core 修改若必要，应拆成独立仓库/构建产物。
- PostgreSQL 是业务 Source of Truth，Redis 只承载队列、锁、限流和短期状态。
- 3x-ui 与 NY 面板均通过显式 Adapter 集成，不在业务 use case 中拼接 HTTP。
- 生产凭据只来自 Zeabur secret store 或用户受控环境变量，不写入仓库或任务文档。
- 在真实外部凭据可用前，可以完成接口、状态机和本地集成验证，但不能宣称线上链路完成。

## Open Questions

- 3x-ui、NY 面板、DNS Provider 与 Zeabur 的真实资源/凭据如何安全注入测试环境。
- 现网 Xray/3x-ui 是否已存在自定义 Email 级限速实现，还是需要新建独立数据面项目。
- 线上全链路测试允许使用的账号、金额、国家、节点和流量预算。

## Out of Scope

- 生产路径中的 Mock、静态假库存、假代理链接、默认成功和 silent fallback。
- 在没有基准测试和回滚方案时直接修改 Xray core。
- 未经授权修改 DNS、生产资金、生产订单、节点防火墙或删除云资源。
- 把单个 Provider、单台 3x-ui 或单次成功当作高可用完成证据。

## Risks and Verification

- 资金：重复请求/回调导致重复入账或扣款；用唯一幂等键、事务和账本对账验证。
- 出口：地理信息过期或 NAT 出口不符；用外部目标实测并记录 freshness。
- 3x-ui：部分节点成功、重试重复创建、面板与 Xray 状态漂移；用 desired/observed projection reconcile 验证。
- 队列：worker 崩溃、重复消息、串行吞吐和无限重试；用租约、退避、DLQ/人工队列和压测验证。
- 限速：锁竞争、计时误差和 TCP 抖动；用长连接、多并发和 CPU/内存基准验证。
- 攻击：连接洪泛耗尽 fd/conntrack；分层限连接并在隔离环境做压力测试。
- 部署：迁移顺序、端口和变量错误；Zeabur read-back、日志和外部 smoke check 验证。

## Research References

- 待补：现有代码功能矩阵与缺口审计。
- 待补：3x-ui API、Xray routing/metrics/限速能力与多节点 desired-state 模式。
- 待补：NY 面板能力、入口拓扑和 DNS 高可用验证方案。
- 待补：Zeabur 目标拓扑、部署契约与线上测试方案。

## Technical Notes

- 当前关键目录：`apps/api/src/modules`、`apps/worker/src`、`apps/web/src/features`、
  `packages/db/prisma/schema.prisma`、`.trellis/spec`。
- 当前 Provider Adapter：IPIPD、985Proxy、PR；手工 SOCKS5 导入尚未在 schema/Adapter 中确认。
- 当前 worker：静态代理履约和库存同步；未发现 3x-ui reconciliation worker。
- 当前恢复快照无 `.git` 历史，已初始化空 Git 仓库；基线提交仍需用户确认。
