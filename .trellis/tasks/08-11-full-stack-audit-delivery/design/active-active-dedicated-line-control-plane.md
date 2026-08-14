# 主动-主动专线控制面设计

状态：已按用户“继续”确认进入实施准备。本文取代旧的“仅 Client 投影”范围，作为本任务后续
实现的架构契约；不替代 PRD 的完整验收矩阵。

## 目标与非目标

目标是让 `SV`、`ZB` 等可扩展 SKU 的专线订单，可靠地完成报价、扣款、出口选择、多个 3x-ui
节点投影、NY 导入线路交付、生命周期变更和审计。多个节点保存同一专线的受控副本，以支撑入口
设备组的多目标转发和显式迁移。

本阶段不让 365Proxy 直接写 NY 面板、DNS Provider、iptables 或任意 Xray JSON；这些系统各自
仍是权威来源。平台只管理经明确接口授予的对象，并把外部确认作为状态转移前置条件。

## 数据权威与流向

```text
Provider sync/import -> residential_exits -> allocation/reservation
customer order -> dedicated_line desired state -> per-node projections
NY panel -> imported delivery route snapshot -> customer delivery view
OpenUI/Xray -> observed projection + usage telemetry -> line status/usage ledger
```

| 领域 | Source of Truth | 读取/写入路径 |
| --- | --- | --- |
| 专线订单、价格、余额、出口分配、节点策略 | 365Proxy PostgreSQL | API/use case -> transaction/outbox -> worker |
| 节点运行配置 | 365Proxy desired state + OpenUI observed hash | reconcile worker -> managed projection API -> read-back |
| NY 入口转发与 DNS | 外部 NY/DNS | 管理员导入快照 -> 365Proxy delivery projection；平台不写回 |
| Provider 可用出口和 SK5 库存 | Provider API 的成功同步结果 | sync/import -> versioned snapshot -> reservation/gate |
| 用户流量 | Xray user Email stats | telemetry collector -> append-only usage observation |

## 拓扑与副本语义

每个订单创建一个 `dedicated_line` 聚合，持有稳定的客户身份、SKU、国家、出口绑定和 desired
version。`dedicated_line_projections` 为它在每个入选 3x-ui 节点上的副本；副本不是独立订单，
不能各自续费、换出口或发货。

- `node_groups` 表示香港节点池和能力约束，节点必须声明区域、协议、入口 profile、容量、健康、
  API 凭据及是否可接受该出口 Provider。
- `line_placement_policies` 按客户、租户、SKU 或管理员强制规则选择节点组、目标副本数、最小
  ready 副本数和单节点容量上限。订单创建后的 placement 固定；变更通过迁移 use case 审计。
- 所有副本使用同一个 `clientEmail` 和受加密保护的 VLESS/VMess 身份。每个节点通过管理员预置的
  `inbound_profile` 接受协议/端口/传输层，专线投影不得改变共享 Inbound 的监听配置。
- 每个副本创建一个受控 SOCKS Outbound 和以 Email 精确匹配的 Route，tag 必须含 365Proxy
  ownership prefix 以及 projection key；route 置于通用 catch-all 规则之前。
- `ACTIVE` 表示目标副本全部经 read-back 验证；`DEGRADED` 表示达到最小 ready 数但未满足冗余；
  `FAILED` 表示没有可交付副本。客户视图必须展示真实状态，不能把 `DEGRADED` 伪装为正常。

一条出口默认是 logical line 的固定绑定。Provider 必须显式声明允许的 `maxReplicaFanout`；不支持
多节点并发的出口不得进入主动-主动 placement，而是拒绝该策略或进入显式热备模式，不能偷偷让
多个节点共享失效凭据。

## NY 与交付线路

`delivery_routes` 保存管理员导入的 NY 转发快照：入口设备组、协议、监听端口、目标节点、目标
端口、导入版本、有效期和多个域名别名。DNS 解析和 TCP/协议检查仅是观测，不会覆盖导入快照。

迁移是严格的四阶段状态机：

1. 分配目标节点并在新副本 apply/read-back 成功。
2. 管理员在 NY 更新目标设备组或端口转发。
3. 管理员导入新的 NY route snapshot，平台校验目标节点/端口与 ready projection 一致。
4. 从外部客户端完成协议、认证、目标可达和出口国家 smoke test 后，才允许回收旧副本。

若第 2 或第 3 步未完成，线路保持 `MIGRATING_AWAITING_ROUTE_IMPORT`，不展示“迁移完成”。

## 出口、库存与购买 Saga

`residential_exits` 统一承载 IPIPD、985 SK5、手工导入和后续 Provider 的真实 SOCKS5 资源；凭据
AES-GCM 加密，identity fingerprint 仅用于去重。`exit_health_observations` 保存真实出口 IP、国家、
时延、失败类型和 freshness。周期探测只 claim 已分配或待迁移的出口。

下单使用专线专属 saga，不能调用静态代理 `proxy_instances` 发货路径：

1. 读取受支持 SKU 的最新 SK5 资源映射和成功库存快照，创建带到期时间的数量 reservation。
2. 在同一 PostgreSQL transaction 内锁定 reservation、扣款、创建 dedicated line/order outbox。
3. Worker 在调用 Provider buy 前检查 reservation 未过期、数量仍满足、出口匹配结果有效；失败时
   不调用购买 API，释放 reservation 并通过事务 outbox 发送带去重键的 Bark 告警。
4. Provider buy 成功后，写入出口而非向客户暴露 SOCKS 凭据；只有所有最低副本投影成功且 route
   snapshot 已确认时才发货。

`SK5` 的真实 request/response 字段必须由 985 的实际成功库存样本或供应商确认定义。不得把现有
`shared`/`premium` 映射猜测为 SK5。

## Worker、幂等与补偿

所有外部副作用采用独立 job/outbox 表，包含 `leaseOwner`、`leaseExpiresAt`、`desiredVersion`、
attempt、nextRunAt、idempotency key 和结构化失败原因。claim、完成和失败更新均以 lease owner +
desired version 为条件，避免长任务被第二个 worker 重复执行。

订单批处理使用有界并发池，而非顺序循环。并发预算分为 Provider purchase、节点投影、出口测活和
遥测四类，分别限流；同一出口、同一节点或同一 line 的冲突动作以细粒度锁串行。失败进入 retry、
`NEEDS_OPERATOR` 或明确 refund/reconcile 状态，不允许因为本地超时就默认退款或默认成功。

## OpenUI/Xray 受管接口

在 OpenUI 新增 Bearer-token `managed-line-projections` 模块，而不是让 365Proxy 调用会话 CSRF
接口覆盖整份 Xray 模板。接口以 `projectionKey + desiredVersion` 幂等 reconcile 以下受管对象：

- 指定共享 Inbound profile 内的 Client；
- 该专线的 SOCKS Outbound；
- `inboundTag + user Email -> outboundTag` Route；
- Client enable、expiry、quota、速率与并发配置。

接口必须校验 ownership tag、端口和命名冲突，apply 后读取回配置并返回 observed version/hash；删除
只能删除自己创建的对象。OpenUI SQLite 只保存运行投影，365Proxy PostgreSQL 才是订单真相。

## 限速、配额与抗攻击

Xray Email stats 用于累计流量配额；达到上限后由生命周期 worker 禁用 Client 并记录 telemetry
时间点。即时带宽限速属于自定义数据面：每个节点必须使用共享的
`inboundTag + email + direction` limiter registry，按 bytes/s 节流和 context-aware wait，不可为每条
连接新建 token bucket，不可丢弃已读取 TCP 数据来“限速”。VLESS/VMess config mapping、registry TTL、
多连接公平性、长连接抖动、CPU/内存基准必须有测试证据。

在跨节点主动-主动场景，未通过分布式限速基准前，平台不得宣称 cluster-wide 精确限速。受限线路要么
使用入口亲和的单 active data replica，要么由经验证的分布式 token lease 服务协调。配置副本可以
主动-主动，数据面承诺必须与实际 limiter 能力一致。

攻击防护分层：入口防火墙/conntrack/SYN backlog 在认证前限流；Xray 在认证后按 Email 限制连接数；
365Proxy 根据审计事件做 Email 冷却、出口隔离和运维告警。Fail2Ban 只能是可选补充，不能代替前两层。

## 用户与 Reseller 可见性

ToC 客户可以看到自身专线状态、交付链接、用量、续费、开关、限速和工单，但永不看到住宅 SOCKS
凭据。Reseller 绑定自己拥有的上游 365Proxy APIKey，可扫描余额/库存/价格并向下级客户售卖；其
订单 facade 返回下级客户授权可见的 delivery 信息，绝不返回上游出口或其他下级客户链接。客服入口
由平台 site configuration 统一提供。

旧静态住宅购买 surface 将从客户与 Reseller 目录移除；旧数据保留为历史只读，不能作为库存不足的
fallback。

## 发布与验收

Zeabur 需要独立 API、Web、Worker、PostgreSQL、Redis 服务定义，API migration job 和依赖顺序；
OpenUI 部署在受控香港 Linux 节点，不部署为 Zeabur 控制面应用。上线前必须完成 migration、build、
focused/integration tests、browser workflow、node API health、NY snapshot/DNS/TCP/protocol、真实认证、
出口国家、稳定性、配额、限速和停用的外部验收。任一外部前置条件缺失时，验收状态为未验证而不是
成功。
