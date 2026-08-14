# 365Proxy 全链路交付计划

> 前置设计：[主动-主动专线控制面设计](../../../.trellis/tasks/08-11-full-stack-audit-delivery/design/active-active-dedicated-line-control-plane.md)
>
> 本计划替代仅覆盖 Client projection 的旧 foundation plan。每阶段完成前都需要真实测试证据，不能
> 以编译通过代替外部控制面或数据面验收。

## Phase 0: 恢复基线与隔离

1. 对恢复源码执行受限 secret 扫描，确认 `.env`、私钥和聊天凭据未进入 Git。
2. 将恢复后的源码、Trellis 研究和已确认设计形成第一个 Git baseline commit。
3. 从 baseline 创建 `feat/dedicated-line-control-plane` worktree；后续应用与 OpenUI 的改动各自
   保持独立 Git 历史。
4. 验证 `pnpm install --frozen-lockfile`、Prisma generate、lint、typecheck、build；记录已有测试
   夹具漂移，不把失败归因到新专线代码。

## Phase 1: 产品切换与目录契约

涉及：`packages/db/prisma/schema.prisma`、`apps/api/src/modules/catalog/`、`apps/api/src/modules/orders/`、
`apps/web/src/routes/customer/`、`apps/web/src/features/customer-proxies/`。

1. 引入可扩展 `line_skus`、SKU capability、订单项和专线价格域；首批 seed 为 `SV`、`ZB`。
2. 禁用客户/Reseller/API 的静态住宅购买路由和菜单，将旧 orders、proxy instances、pricing 留作
   历史只读；不得移除资金/审计历史。
3. 复用现有价格 template/override 优先级，扩展为 SKU 价格 quote，并在订单保存不可变快照。
4. 先写 API contract、customer/admin catalog 和 authorization 测试，再写 migration 与 UI。

验收：客户、管理员、Reseller 均无法创建 `STATIC_PROXY_BUY`；SV/ZB 可获得真实报价，旧数据可查
但不可购买。

## Phase 2: 专线、出口、节点和路由数据模型

涉及：Prisma schema/migration；新建 `dedicated-lines`、`exit-pool`、`node-control`、`delivery-routes`
模块。

1. 建立 dedicated line、placement policy、node group/node、inbound profile、per-node projection、
   delivery route/domain alias、exit assignment/health observation、stock reservation、outbox/job 等模型。
2. 所有资源使用 site/tenant/user ownership，敏感凭据 AES-GCM 存储；对 external IDs、projection key、
   reservation、outbox dedupe 建立数据库唯一约束和必要索引。
3. 实现状态机与 desired version，测试非法迁移、过期 lease、stale worker、重复请求和 tenant 越权。
4. 在可丢弃 PostgreSQL 上执行 migration 两次，第二次必须无 pending migration。

验收：没有任何新逻辑误用 `proxy_instances`；所有 mutation 有 audit/outbox，数据库可阻止重复投影。

## Phase 3: Provider、SK5 库存和出口池

涉及：`providers`、`resources`、新 `exit-pool` worker 与管理 UI。

1. 在获得真实 985 SK5 inventory/buy 样本后，实现明确资源映射；没有样本时保留受控禁用，不猜字段。
2. 引入 SKU/国家/数量库存 snapshot 和 reservation；不足时禁止 buy call、创建去重 Bark outbox 事件。
3. 接入 IPIPD sandbox/production 为独立 provider account；实现手工 SOCKS5 CSV/API 导入、到期时间、
   去重和加密。
4. 实现按国家、状态、有效期、provider fanout 能力匹配出口，订单外不展示 SOCKS credential。
5. 仅调度已分配/待迁移出口，通过可信 GeoIP observation 验证国家；不匹配即隔离并触发重分配。

验收：库存不足单元/集成测试中 985 buy mock 必须为零调用且 Bark event 恰好一次；Geo mismatch 无法发货。

## Phase 4: 专线订单 Saga 与受控并发 Worker

涉及：新 `dedicated-line-order` use case、wallet/outbox、`apps/worker`。

1. 交易内完成 quote、reservation、余额扣款、order/line/job/outbox/audit；对请求和 Provider side effect
   使用可恢复幂等键。
2. 实现 lease owner、heartbeat、bounded retry、DLQ/`NEEDS_OPERATOR`、reconciliation；禁止超时后直接
   假定外部失败并退款。
3. 将现有 sequential `FulfillmentWorker` 改为有界 worker pool，按 Provider、node、exit、line 分别
   限流；编写十个 slow job 的并发证明和抢占/崩溃恢复测试。
4. worker 日志仅含 IDs、状态、reason key，不含 Provider/节点/客户明文凭据。

验收：10 个独立投影不再串行 10 倍延迟；同一 line/exit 的冲突动作仍串行；崩溃不会导致双买或双退款。

## Phase 5: OpenUI 托管投影 API

在 `C:\Users\Lenovo\Desktop\3xui\OpenUI` 独立实现和提交。

1. 新建受 Bearer token 保护的 `ManagedLineProjectionService` 与 API；只接收 projection key、desired
   version、inbound profile、client、SOCKS outbound、Email route 和 lifecycle settings。
2. 实现 ownership tag 校验、冲突保护、atomic reconcile、apply/read-back、observed config hash 和仅自有
   对象删除；不接受全局 Xray JSON，也不使用网页登录/CSRF surface。
3. 覆盖 VLESS、VMess、mixed profile；确保 order 的 Email route 位于通用规则之前，并验证 route hit。
4. 进行 HTTP transport、idempotency、partial failure、restart/re-read 和 authorization 测试；Go test、
   Go build、frontend lint/build 都必须通过。

验收：重复相同 desired version 无配置 churn；非 365Proxy tag 不可读写；任何 Apply 后状态都可 read-back。

## Phase 6: Xray 限速、配额与攻击防护

在自定义 Xray-core fork 及 OpenUI 配置层独立实施，必须先建 benchmark。

1. 修复 VLESS/VMess 的速率/连接字段映射；为 `inboundTag + email + direction` 建共享 limiter registry，
   使用 TTL/引用计数防止内存泄漏。
2. 用 blocking/pacing 代替断流或丢弃；覆盖多连接公平、低速长连接、关闭、context cancel、CPU/内存。
3. 把配额 telemetry 与即时 rate limit 分离；未完成 cluster limiter benchmark 时，仅对具有入口亲和的
   active data replica 宣称精确限速。
4. 增加节点安全配置、连接上限、Fail2Ban 可选集成、推荐防火墙/conntrack 规则和 audit webhook。

验收：VLESS/VMess/HTTP/SOCKS 都正确读取值；同 Email 多连接总速率不超过单节点配置误差；压测无
非预期 TCP reset、goroutine/内存持续增长或连接池耗尽。

## Phase 7: 生命周期、交付、用户与管理员面板

涉及：专线 API/OpenAPI、customer/admin features、dashboard、support integration。

1. 实现开关、续费、增加流量、限速、出口切换、批量续费/导出、取消和迁移 use cases；每次操作增加
desired version 和审计。
2. 管理员导入/校验 NY route snapshot 与 domain aliases；迁移强制等待 route import 和外部 smoke。
3. 客户只看自己的 delivery link、状态、用量、账本和工单；管理员看节点、出口、路线、队列、Bark
告警和可恢复失败；所有 loading/empty/error/permission 状态真实可达。
4. 扩展 API key scope、OpenAPI 和 dashboard 为专线概念；API key 仅展示一次，出站 SOCKS 密钥永不
进入 customer/reseller response。

验收：浏览器流程从充值到下单、发货、续费、停用完整可操作；权限与密钥 redaction 测试通过。

## Phase 8: 365Proxy-Reseller

涉及：`customer-reseller` domain、upstream account adapter、Reseller UI/API。

1. 管理员控制代理注册/创建；代理加密绑定其 365Proxy APIKey，并能真实扫描余额、库存和定价。
2. 建立代理租户的全局/模板/用户价格、下级充值和下级专线下单 facade；上游余额与价格以扫描结果为
权威，不以本地 copy 冒充实时数据。
3. 严格隔离代理、下级客户、平台客服和交付权限；代理不能读取任何下级 SOCKS 凭据或不属于自己的
专线链接。

验收：跨 tenant API/UI 越权测试失败；Reseller 从余额扫描到下级订单的全流程可追踪且不泄露凭据。

## Phase 9: Zeabur 与真实全链路验收

1. 增加 API/Web/Worker Dockerfile 和 Zeabur service manifests/说明，配置 PostgreSQL、Redis、
   migration、health check、startup order、secret names 和 rollback steps；删除阻断 release 的 root
   Railway shim 后再执行 predeploy check。
2. 在 Zeabur 部署控制面，读取 build/runtime logs、migration、health、domain/env；OpenUI 仅部署到
   受控香港 Linux 节点。
3. 由管理员完成 NY snapshot 导入与 DNS 修正；从外网 client 验证 VLESS/VMess/mixed 认证、目标可达、
   出口国家、至少一轮副本故障/迁移、配额、限速和停用。
4. 将每项验收的时间、目标、观察值、截图/日志位置和失败项写回 Trellis；未具备生产授权或网络可达
   时保留为明确未验证。

## 每阶段质量门

- 修改行为先写失败测试，之后运行相关单元、集成、迁移和浏览器测试。
- 全仓质量门：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`；先修复现有 fixture drift 或
  明确隔离其已知失败，不能把红灯解释为新功能通过。
- OpenUI/Xray 每次变更运行 Go test/build 和针对限速/连接的 benchmark。
- 任何外部写操作前校验配置、TLS、权限、幂等键和目标；所有外部失败保持可见、可重试、可审计。
