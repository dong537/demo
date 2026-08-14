# Research: 生产能力覆盖审计

- Query: 只读审计 `365-production` 中 API、Worker、Prisma 与部署配置，对照 SV/ZB、禁售家宽、985 SK5 库存硬门/Bark、IPIPD、客户订单固定到多 3x-ui 节点、多域名/NY 导入、投影/reconcile、迁移、续费/限额、审计和生产配置门禁，判断哪些已实现、部分实现、缺失或无法验证。
- Scope: internal（代码、Trellis、历史部署验证记录）；未读取生产 secret，未对 Zeabur、Provider、OpenUI、NY 或 DNS 发起实时请求。
- Date: 2026-08-14

## Findings

### 1. 结论

当前仓库已经形成较完整的专线控制面骨架：Prisma 聚合、SV/ZB SKU、禁售旧静态家宽、库存预留与资金扣减、外部 Job、Provider Adapter、专线/出口/节点固定关系、OpenUI 托管投影、NY 快照导入、多域名、本地生命周期与迁移数据模型均存在。

但它还不能被判定为“生产专线全链路已完成”。至少存在以下阻断项：

1. **IPIPD 专线交付必然与 SOCKS5 契约冲突**：Adapter 把每个实例硬编码成 `HTTP`，专线处理器只接受 `SOCKS5`；缺失到期时间时还会落成当前时间，立即被判过期（`apps/api/src/modules/providers/adapters/ipipd.adapter.ts:206`、`:213`；`apps/api/src/modules/dedicated-line-orders/process-dedicated-line-order.use-case.ts:186`）。
2. **迁移状态机没有可运行闭环**：smoke/cleanup use case 被 DI 注册、导出，但 Controller 只有 create/get/list/commit/cancel，Worker 也没有调度它们（`apps/api/src/modules/dedicated-line-migrations/dedicated-line-migrations.module.ts:13`；`apps/api/src/modules/dedicated-line-migrations/dedicated-line-migrations.controller.ts:21`）。因此常规流程无法从 canary 自动/手动推进至可 commit，也无法完成 cleanup。
3. **迁移会遗留远端 OpenUI 状态**：Adapter 定义了 `delete()`，生产源码没有任何调用；cancel/commit 只删除本地 projection 行（`apps/api/src/modules/dedicated-line-projections/managed-line-projection.adapter.ts:67`；`apps/api/src/modules/dedicated-line-migrations/cancel-migration.use-case.ts:22`；`apps/api/src/modules/dedicated-line-migrations/commit-migration.use-case.ts:67`）。远端旧 client/outbound/route 可能继续生效。
4. **迁移 commit 过早宣布 `ACTIVE`**：它把目标 projection 重置为 `PENDING` 并重新排队后，立即把 line 更新为 `ACTIVE`（`apps/api/src/modules/dedicated-line-migrations/commit-migration.use-case.ts:72`、`:90`、`:106`），违反“部分失败不得报告成功”的状态语义。
5. **SV/ZB 缺少可运营的 Provider 库存映射**：seed 仅创建 SKU 能力，不写 `capabilities.inventorySource`；同步仓储却要求每个 SKU 明确配置 provider code 与 resource IDs，否则跳过该 SKU（`apps/api/src/modules/catalog/sku-seed.ts:22`；`apps/api/src/modules/dedicated-line-orders/dedicated-line-inventory.repository.ts:72`、`:425`）。仓库中该字段只见于测试 fixture，未找到管理 API 或脚本。
6. **生产配置门禁不完整**：可以开启专线下单、同时关闭 OpenUI 投影；也不要求 Bark、专线库存同步、节点/路由/价格等依赖就绪。该组合可能先扣款和真实购买出口，再长期停在未投影/待运营状态（`apps/api/src/common/config/config-guard.ts:22`；`.env.example:49`、`:52`）。
7. **最近一次仓库内线上记录仍是关闭状态**：2026-08-12/13 的只读记录显示订单执行、投影、Bark 全关闭，且价格规则、Provider 账号、库存、placement、节点、inbound、route、line 都为 0（`.trellis/tasks/08-11-full-stack-audit-delivery/research/phase-7-zeabur-production-verification.md:51`、`:83`、`:160`）。该记录不是 2026-08-14 的实时查询，但足以说明尚无已留档的真实生产 E2E 证据。

整体判定：**控制面实现度中高，真实外部交付与生产运营完成度不足；不应打开生产专线订单执行门。**

### 2. 能力矩阵

| 能力 | 判定 | 代码/证据 | 仍缺什么 |
| --- | --- | --- | --- |
| SV/ZB 商品 | 部分实现 | seed 定义两个 active、visible、`dedicated-line` SKU；脚本按 site upsert（`apps/api/src/modules/catalog/sku-seed.ts:17`、`:22`；`apps/api/scripts/seed-line-skus.ts:8`） | 无默认价格规则、无 Provider resource 映射管理面；历史生产记录价格为 0 条 |
| 禁止旧家宽购买 | 已实现 | customer/admin/OpenAPI 的购买入口统一抛 `PRODUCT_DISABLED` 410（`apps/api/src/modules/orders/static-purchase-disabled.ts:4`；`apps/api/src/modules/orders/orders.controller.ts:31`；`apps/api/src/modules/openapi/res-static.controller.ts:108`） | 历史订单/资源读路径保留，符合“只读历史”要求 |
| 985 SK5 库存硬门 | 代码已实现，生产未验证 | fresh snapshot 选路；SQL 条件更新保证 `quantity-reserved >= requested`；买前先预留、扣款、建 Job（`apps/api/src/modules/dedicated-line-orders/dedicated-line-inventory.repository.ts:31`、`:159`；`apps/api/src/modules/dedicated-line-orders/create-dedicated-line-order.use-case.ts:35`、`:73`） | SKU `inventorySource` 缺运营入口；无真实 985 sample/线上 buy 证据 |
| Bark 库存不足告警 | 代码已实现，生产未启用 | 无 route 时在失败前写去重 outbox；Bark Worker 处理重试/终态（`apps/api/src/modules/dedicated-line-orders/create-dedicated-line-order.use-case.ts:35`；`apps/api/src/modules/dedicated-line-orders/dedicated-line-inventory.repository.ts:270`；`apps/api/src/modules/alerts/process-bark-alert-outbox.use-case.ts:19`） | 最近线上记录为关闭；只覆盖下单库存不足，未见 stale-sync/出口健康告警 |
| IPIPD Provider | 阻断 | 有鉴权、库存、buy、query 代码（`apps/api/src/modules/providers/adapters/ipipd.adapter.ts:261`、`:321`、`:382`） | 映射硬编码 HTTP，与专线 SOCKS5 校验冲突；缺真实响应契约回放与 E2E |
| 客户/订单固定出口与多节点 | 控制面已实现，数据面未验证 | 完成单会持久化 exit、assignment、placement nodes、line 与每节点 projection；节点容量用条件更新（`apps/api/src/modules/dedicated-line-orders/dedicated-line-order.repository.ts:123`、`:401`） | 外部 OpenUI 不在本 worktree；无真实多节点交付、协议握手、扩容/故障证据 |
| Managed projection | 部分实现 | PUT 后 GET read-back，校验 projection key、version、status、desired/observed hash，再标 READY（`apps/api/src/modules/dedicated-line-projections/process-dedicated-line-projection.use-case.ts:31`、`:39`；`apps/api/src/modules/dedicated-line-projections/managed-line-projection.adapter.ts:59`） | 本仓库无 OpenUI server 实现；生产节点/投影数据为空；外部调用审计不足 |
| Reconcile/漂移 | 部分实现 | 健康任务读取实际 projection 并比较 version/hash，存 observation、生成迁移建议（`apps/api/src/modules/dedicated-line-health/control-node-health.use-case.ts:10`、`:29`、`:41`、`:52`） | 不会自动重新 apply/repair；是“观测+建议”，不是完整 reconcile |
| NY 路由导入 | 本地快照实现 | 管理员导入具备 fingerprint 幂等、版本、route targets、migration stage 校验，不写 NY（`apps/api/src/modules/dedicated-lines/delivery-routes.controller.ts:13`；`apps/api/src/modules/dedicated-lines/delivery-route-import.use-case.ts:33`、`:48`、`:82`） | 无 NY 读取 Adapter/实时 read-back；只能信任人工提交快照；历史生产 routes=0 |
| 多域名 | 本地绑定实现 | hostname/role/port 校验并写审计（`apps/api/src/modules/dedicated-lines/line-domain-bindings.use-case.ts:20`、`:52`） | 未找到 DNS Provider observation/解析验证；不能证明域名实际指向入口 |
| 迁移 | 数据模型存在，运行闭环阻断 | create 会预留目标出口/节点、创建目标 projections/jobs；commit 检查 route/projection/smoke（`apps/api/src/modules/dedicated-line-migrations/create-migration.use-case.ts:51`、`:97`；`apps/api/src/modules/dedicated-line-migrations/commit-migration.use-case.ts:23`） | smoke/cleanup 不可达、远端 delete 未用、commit 过早 ACTIVE；见阻断项 2-4 |
| 续费 | 部分实现 | 客户 renew 会报价、幂等扣款、延长 line、增 version、重新投影（`apps/api/src/modules/dedicated-lines/delivery-routes.controller.ts:43`；`apps/api/src/modules/dedicated-lines/renew-dedicated-line.use-case.ts:44`、`:99`） | 不调用 Provider renew；只能续到现有 exit 到期日以内（`:62`、`:68`）；无续费审计日志 |
| 流量/限速/IP/连接数 | 管理控制面实现 | limits use case 全量更新 quota/uplink/downlink/maxConnections/ipLimit，增 version、投影、审计（`apps/api/src/modules/dedicated-lines/update-dedicated-line-limits.use-case.ts:91`、`:102`、`:145`） | 无客户付费扩容 SKU/quote/order；真实 OpenUI/Xray enforcement、单位与性能未在本仓库验证 |
| 暂停/恢复 | 已实现，外部未验证 | 状态变更、version、projection job、审计在同一事务（`apps/api/src/modules/dedicated-lines/dedicated-line-lifecycle.use-case.ts:40`、`:62`、`:97`） | 无真实节点 read-back/连接测试证据 |
| 审计/外部调用日志 | 部分实现 | lifecycle、limit、domain、migration create/commit 有 audit；Provider HTTP 有 upstream log repository（`apps/api/src/modules/dedicated-lines/dedicated-line-lifecycle.use-case.ts:97`；`apps/api/src/modules/providers/provider-registry.service.ts:163`） | 下单/扣款/Provider 完成、续费、route import、migration cancel/smoke/cleanup 无完整业务 audit；OpenUI/NY 缺统一 request ID/耗时/外部 ID 日志 |
| Prisma/migration | 已建模，最新生产应用状态未知 | schema 覆盖 audit、SKU、exit、node、order、line、projection、route/domain、migration、reservation/job/outbox（`packages/db/prisma/schema.prisma:530`、`:1072`、`:1099`、`:1176`、`:1278`、`:1312`、`:1415`、`:1493`、`:1526`、`:1562`、`:1768`、`:1801`、`:1838`）；目录共 18 个迁移，最近为 `20260813090000_add_dedicated_line_migrations` | 历史线上记录只证明当时 17 个迁移；本次未实时执行 `migrate status`，不能声称最新迁移已上线 |
| Railway/Zeabur 启动 | 部署壳存在，业务未 ready | API pre-deploy 执行 `migrate:deploy`；Worker 独立 start（`apps/api/railway.json:9`；`apps/worker/railway.json:9`） | predeploy check 不验证 Provider/节点/route/价格/read-back；线上业务 gate/data 最近仍空 |
| 手工 SOCKS5 导入/出口健康 | 缺失 | PRD/计划明确要求批量 CSV/API、到期、来源、状态、geo/health（`.trellis/tasks/08-11-full-stack-audit-delivery/prd.md:67`；`docs/superpowers/plans/2026-08-11-365proxy-full-delivery.md:51`） | 精确检索未找到 manual import Controller/use case，也未找到 `residential_exits` 的协议级探测与 geo quarantine 链路 |

### 3. 关键数据结构与 Source of Truth

1. 商品与报价：`service_skus` + `sku_price_rules` 是本地商品/价格 Source of Truth（`packages/db/prisma/schema.prisma:1072`）。SV/ZB seed 只覆盖商品，不覆盖价格。
2. Provider 账号与凭据：`provider_accounts` 由 registry 按 tenant 优先、site fallback 读取；disabled/缺账号明确返回 disabled，不伪造启用（`apps/api/src/modules/providers/provider-registry.service.ts:26`、`:43`、`:205`）。
3. 库存：Provider 返回是外部事实，`dedicated_line_inventory_snapshots` 是带新鲜度的本地快照，`stock_reservations` 是本地下单占用。选路要求快照 fresh、账号 active、租户范围匹配且净库存大于 0（`apps/api/src/modules/dedicated-line-orders/dedicated-line-inventory.repository.ts:31`、`:46`）。
4. 资金：下单事务先创建 immutable order/reservation，再写钱包 debit 与 external job；条件库存更新在真实 buy 前（`apps/api/src/modules/dedicated-line-orders/dedicated-line-inventory.repository.ts:127`、`:175`、`:214`、`:229`）。
5. 出口与归属：Provider 完成结果落 `residential_exits`；`dedicated_line_exit_assignments` 固定 line 到 exit；placement 与 placement nodes 固定 line 到具体 3x-ui 节点，订单完成后不静默重新挑节点（`apps/api/src/modules/dedicated-line-orders/dedicated-line-order.repository.ts:123`）。
6. 数据面 desired state：`dedicated_lines` + exit assignment + placement + inbound profile 构成 desired projection；`dedicated_line_projections` 保存每节点 desired/observed version/hash（`packages/db/prisma/schema.prisma:1312`、`:1415`）。
7. NY：外部 NY 配置才是 Source of Truth；平台只保存版本化导入快照。实现未写 NY，符合边界，但也没有独立读取验证 Adapter（PRD `.trellis/tasks/08-11-full-stack-audit-delivery/prd.md:124`）。
8. 迁移：`dedicated_line_migrations` 及 node/smoke/route 关联保存显式版本化迁移状态；当前执行入口不足使模型不能转化为可靠运行流程（`packages/db/prisma/schema.prisma:1562`）。

### 4. 实际调用链

#### 4.1 库存同步

`Worker timer -> InventorySyncWorker -> SyncProviderInventoryUseCase -> ProviderRegistry/Adapter.getInventory -> DedicatedLineInventoryRepository.syncProviderSnapshot`

- Worker 只在库存同步 gate 开启时轮询；Provider account 还必须 active 且 `inventorySyncEnabled`。
- Provider 原始 inventory 会先写通用库存快照；只有 SKU capabilities 存在匹配的 `inventorySource` 才投影为专线可售库存（`apps/api/src/modules/dedicated-line-orders/dedicated-line-inventory.repository.ts:64`、`:72`）。
- 985 Adapter 把国家/库存类型组合为 provider resource ID，逻辑可供显式映射使用（`apps/api/src/modules/providers/adapters/nine-eight-five.adapter.ts:163`）。

#### 4.2 下单、资金与 Provider 购买

`POST dedicated-line order -> CreateDedicatedLineOrderUseCase -> fresh route -> placement capacity -> quote -> reservation/debit/job -> Worker -> ProcessDedicatedLineOrderUseCase -> Provider buy/query -> persist exit/line/placements/projections`

- 无可用 route 时不调用 Provider，写 Bark outbox 后返回明确库存错误（`apps/api/src/modules/dedicated-line-orders/create-dedicated-line-order.use-case.ts:35`）。
- 库存预留用数据库条件更新作为 hard gate，不依赖先查后写（`apps/api/src/modules/dedicated-line-orders/dedicated-line-inventory.repository.ts:159`）。
- Worker 对 expired purchase lease 转 `NEEDS_OPERATOR`，避免不确定购买结果自动重复下单（`apps/api/src/modules/dedicated-line-orders/dedicated-line-order.repository.ts:82`）。
- 处理器只把明确 `UPSTREAM_OUT_OF_STOCK` / `UPSTREAM_DISABLED` 视为“确定未购买”，释放库存并退款重试；其他 Provider/校验错误会保留 reservation、进入人工处理（`apps/api/src/modules/dedicated-line-orders/process-dedicated-line-order.use-case.ts:141`、`:147`）。这对不确定购买有保守性，但对明确的本地契约错误也可能长期占用库存，需细分失败类型。
- 预留 TTL 为 5 分钟。若 Provider pending 超时至预留过期后才成功，完成事务会拒绝过期 reservation；该路径需要真实长耗时测试和明确的“已买但未持久化”恢复策略。

#### 4.3 OpenUI 投影与 line 激活

`Projection Worker -> claim external job -> build deterministic desired request -> PUT /panel/api/managed-line-projections/:key -> GET read-back -> mark READY -> settle line status`

- Adapter 请求包括 client identity、SOCKS egress、限额和生命周期，URL/TLS/SSRF 与 Bearer token 读取集中在 Adapter 内（`apps/api/src/modules/dedicated-line-projections/managed-line-projection.adapter.ts:14`、`:74`、`:120`）。
- 只有全部 replica 的 projection READY 且 observed version/hash 一致，line 才能进一步结算；没有 current NY route 时会停在 `MIGRATING_AWAITING_ROUTE_IMPORT`（`apps/api/src/modules/dedicated-line-projections/dedicated-line-projection.repository.ts:274`）。
- 正常交付链的状态语义较严谨；迁移 commit 旁路了这个条件，形成前述过早 ACTIVE 缺口。

#### 4.4 NY 导入与多域名

`Admin import -> normalize/fingerprint -> persist immutable import -> validate line/migration stage/targets/domains -> versioned delivery route + targets/domains -> settle line status`

- INITIAL 导入只把新的 route 设为 current，并在 projection replicas ready 后把 line 结算为 ACTIVE/DEGRADED（`apps/api/src/modules/dedicated-lines/delivery-route-import.use-case.ts:82`、`:166`）。
- 迁移 CANARY/CUTOVER route 有显式 migration/stage 约束，不直接调用 NY 写接口。
- 域名绑定有本地格式/角色/端口约束和审计，但没有 DNS read-back，故“配置已记录”不等于“公网解析已生效”。

### 5. Provider 具体风险

#### 5.1 985Proxy

- inventory、buy、query、按请求协议映射均存在（`apps/api/src/modules/providers/adapters/nine-eight-five.adapter.ts:163`、`:216`、`:266`、`:296`）。
- 严重契约风险：上游未返回 expiry 时，Adapter 会自行构造 30 天到期日（`:326`、`:330`）。这把未知值伪装成确定的可售期限，违背 Source of Truth 与“禁止 fallback”要求。应将缺失 expiry 视为不可交付，或以经过验证的上游订单字段为唯一来源。
- 未找到当前真实 985 响应样本、provider resource ID 配置或 production buy/read-back 记录，不能只凭 adapter 单测判定上线。

#### 5.2 IPIPD

- HMAC/HTTP 调用、库存、购买、查询结构存在，且走 Provider 账号配置。
- `mapInstance()` 无视请求协议，固定输出 `protocol: 'HTTP'`（`apps/api/src/modules/providers/adapters/ipipd.adapter.ts:204`、`:213`）；专线处理器明确要求每个结果为 `SOCKS5`（`apps/api/src/modules/dedicated-line-orders/process-dedicated-line-order.use-case.ts:186`）。这是确定性阻断，不是“待线上验证”。
- 缺少 expiry 时用 `Date.now()`（`apps/api/src/modules/providers/adapters/ipipd.adapter.ts:206`），随后专线处理器拒绝 `expiresAt <= now`（`apps/api/src/modules/dedicated-line-orders/process-dedicated-line-order.use-case.ts:197`）。
- 现有测试未把 IPIPD Adapter 输出穿过专线 `assertDelivery`，所以该跨 Module 契约缺口没有被覆盖。

### 6. 迁移安全审计

1. create 会锁定 line 版本、保留 source 资源、预留 target capacity/exit、创建带 `migrationId` 的 target projections，设计方向正确（`apps/api/src/modules/dedicated-line-migrations/create-migration.use-case.ts:51`、`:97`、`:101`）。
2. smoke use case 会做外部验证、保存 freshness 5 分钟的 observation，并推进状态（`apps/api/src/modules/dedicated-line-migrations/process-migration-smoke.use-case.ts:13`、`:18`、`:20`）。但没有 Controller/Worker/CLI 调用它。
3. cleanup 会释放 migration node reservation、清 activeMigrationId、完成状态（`apps/api/src/modules/dedicated-line-migrations/process-migration-cleanup.use-case.ts:10`、`:17`、`:27`），同样没有调用入口。
4. cancel 删除的是本地 migration projection 与 queued job（`apps/api/src/modules/dedicated-line-migrations/cancel-migration.use-case.ts:22`），没有先调用远端 DELETE 和 read-back。
5. commit 删除本地 source projections（`apps/api/src/modules/dedicated-line-migrations/commit-migration.use-case.ts:67`），再把 target projections 改名并置 `PENDING`（`:72`），但 line 同事务设 `ACTIVE`（`:106`）。如果后续 OpenUI apply 失败，客户看到的是错误成功状态。
6. commit 返回 phase `CLEANUP`，但 cleanup 不可达，`activeMigrationId` 会继续占用并阻塞后续迁移。

判定：**迁移功能不得用于生产，直到补齐可达的状态机驱动、远端投影删除/read-back、失败补偿、状态结算和端到端测试。**

### 7. 审计与可观测性

已有：

- `audit_logs` 有 site/tenant/actor/target/action/reason/requestId/meta（`packages/db/prisma/schema.prisma:530`）。
- lifecycle、limit、domain、migration create/commit 写业务审计。
- Provider Adapter 请求通过 upstream log repository 记录外部调用（`apps/api/src/modules/providers/provider-registry.service.ts:163`）。
- external job、outbox、health observation 保存异步状态和错误。

缺口：

- 专线下单事务、扣款、Provider 成功交付、route import、续费、migration cancel/smoke/cleanup 未形成一致业务 audit 链。
- OpenUI Adapter 没有复用 Provider upstream log contract；未见统一保存 request ID、外部对象 ID、耗时、结果与脱敏错误。
- NY 是人工导入，没有外部 read adapter；当前记录只能证明“谁导入了本地值”中的一部分，不能证明 NY 实际状态。
- Bark 只覆盖库存不足；Provider inventory stale、OpenUI drift、migration stuck 等关键运营风险未统一路由到告警。

### 8. 生产配置与部署门禁

现有门禁：

- production 强制数据库、Redis、JWT、加密密钥等基础 secret（`apps/api/src/common/config/config-guard.ts:6`）。
- 开启旧履约或专线订单执行时要求至少一项 account allowlist（`:14`、`:22`）。
- Bark 开启时要求 device key（`:30`）。
- 库存同步 interval 不能大于最短 freshness TTL（`:34`）。

缺失门禁：

- `DEDICATED_LINE_ORDER_EXECUTION_ENABLED=true` 时不要求 `DEDICATED_LINE_PROJECTION_EXECUTION_ENABLED=true`。
- 不要求库存同步开启、Bark 开启、SKU price/inventorySource 完整、Provider 账号至少一个 active、节点/placement/inbound/NY route 就绪。
- 无 projection node/account allowlist，专线订单 allowlist 只约束 Provider purchase，不约束哪些 OpenUI 节点可被写入。
- `.env.example` 有订单/投影/Bark gate，但没有列出 schema 中的 `DEDICATED_LINE_HEALTH_EXECUTION_ENABLED` 与 migration smoke 参数（`apps/api/src/common/config/env.schema.ts:26`、`:45`；`.env.example:45`）。示例配置与实际运行 surface 已漂移。
- `scripts/predeploy-check.mjs` 只做仓库/构建入口检查，不验证数据库 migration 状态、Provider、库存新鲜度、节点 read-back、NY route、DNS 或 Bark。

历史生产证据：

- API/Worker/Web/DB/Redis 曾记录为健康，API 有 `migrate:deploy`，说明部署壳可运行。
- 同一记录明确说明所有专线业务执行 gate 关闭，相关生产数据为空，没有真实 line mutation、OpenUI read-back 或协议握手（`.trellis/tasks/08-11-full-stack-audit-delivery/research/phase-7-zeabur-production-verification.md:51`、`:85`、`:162`）。

因此当前 production-ready gate 应至少要求：价格与 SKU 映射检查、Provider inventory freshness、Bark、订单与 projection 同开、控制节点 read-back、placement/inbound/route 完整、最新 migration、一次受控真实订单及 SOCKS5/入口协议握手、续费/暂停/恢复 read-back。缺一项均不能宣称生产闭环。

### 9. 测试覆盖评价

- 库存硬门、Bark 去重、订单完成仓储、投影 hash/read-back、限额、生命周期等有针对性单元/集成测试，说明核心本地不变量得到一定覆盖。
- `dedicated-line-order-completion-integration.spec.ts` 直接向仓储传入构造的 proxy，不能替代 Provider Adapter -> Worker -> DB -> OpenUI 的真实链路。
- IPIPD 测试没有断言结果协议必须等于请求的 SOCKS5，也没有穿过 `ProcessDedicatedLineOrderUseCase.assertDelivery`。
- `process-migration-smoke.use-case.spec.ts` 只验证可实例化，不能证明状态推进；缺少 create -> target projections ready -> canary route -> smoke -> cutover -> commit -> cleanup 的公共 Interface 测试。
- 迁移测试未覆盖远端 projection 删除、commit 后 apply 失败、cleanup 调度和 line 不得过早 ACTIVE。
- 本次审计未运行测试命令；结论来自源码、已有测试内容与已有部署记录，而不是一次新的绿灯测试报告。

### 10. Files found

- `.trellis/tasks/08-11-full-stack-audit-delivery/prd.md`：权威业务目标、Source of Truth、生产验收与不做事项。
- `docs/superpowers/plans/2026-08-11-365proxy-full-delivery.md`：分阶段完整交付计划，含库存、Provider、OpenUI、NY、生命周期和生产验收。
- `.trellis/tasks/08-11-full-stack-audit-delivery/research/phase-7-zeabur-production-verification.md`：2026-08-12/13 生产服务与业务 gate/数据的历史只读证据。
- `packages/db/prisma/schema.prisma`：专线控制面的持久化 Source of Truth。
- `packages/db/prisma/migrations/20260811040000_add_dedicated_line_control_plane/`：专线控制面初始迁移。
- `packages/db/prisma/migrations/20260811190000_add_dedicated_line_ip_limit/`：IP 限制迁移。
- `packages/db/prisma/migrations/20260811230000_add_dedicated_line_orders/`：专线订单迁移。
- `packages/db/prisma/migrations/20260811233000_add_federated_upstream_connections/`：联邦上游连接迁移。
- `packages/db/prisma/migrations/20260813090000_add_dedicated_line_migrations/`：显式专线迁移状态机数据结构。
- `apps/api/src/modules/catalog/sku-seed.ts`：SV/ZB SKU seed 定义。
- `apps/api/src/modules/orders/static-purchase-disabled.ts`：旧静态家宽禁售的统一错误入口。
- `apps/api/src/modules/dedicated-line-orders/create-dedicated-line-order.use-case.ts`：库存/placement/报价/预留/扣款/Job 编排。
- `apps/api/src/modules/dedicated-line-orders/dedicated-line-inventory.repository.ts`：fresh inventory、原子预留、订单/资金/Bark outbox 持久化。
- `apps/api/src/modules/dedicated-line-orders/process-dedicated-line-order.use-case.ts`：Provider buy/query、SOCKS5/国家/数量/到期校验与交付计划。
- `apps/api/src/modules/dedicated-line-orders/dedicated-line-order.repository.ts`：异步 lease、出口/线路/节点/投影落库、失败补偿。
- `apps/api/src/modules/providers/adapters/nine-eight-five.adapter.ts`：985 库存、购买、查询与交付映射。
- `apps/api/src/modules/providers/adapters/ipipd.adapter.ts`：IPIPD 库存、购买、查询与交付映射。
- `apps/api/src/modules/alerts/process-bark-alert-outbox.use-case.ts`：Bark outbox 投递与重试。
- `apps/api/src/modules/dedicated-line-projections/managed-line-projection.adapter.ts`：OpenUI managed projection HTTP 契约。
- `apps/api/src/modules/dedicated-line-projections/process-dedicated-line-projection.use-case.ts`：投影 apply/read-back 校验。
- `apps/api/src/modules/dedicated-line-health/control-node-health.use-case.ts`：projection 漂移观测与迁移建议。
- `apps/api/src/modules/dedicated-lines/delivery-route-import.use-case.ts`：NY route/domain 版本化快照导入。
- `apps/api/src/modules/dedicated-lines/renew-dedicated-line.use-case.ts`：本地续费、扣款与重新投影。
- `apps/api/src/modules/dedicated-lines/update-dedicated-line-limits.use-case.ts`：流量/速率/连接/IP 限制更新。
- `apps/api/src/modules/dedicated-line-migrations/`：迁移 create/smoke/commit/cancel/cleanup 与状态机。
- `apps/worker/src/main.ts`：库存、订单、Bark、projection、health worker 调度；未包含迁移 smoke/cleanup。
- `apps/api/src/common/config/config-guard.ts`：生产配置守卫。
- `apps/api/railway.json`、`apps/worker/railway.json`：API migration 与 API/Worker 启动配置。
- `docs/ipipd-openapi-v2.yaml`：本地 IPIPD v2 API 参考；未把它视为真实线上响应证据。

### 11. Related specs

- `.trellis/spec/architecture.md`：领域边界与 Source of Truth。
- `.trellis/spec/api-contract.md`：统一响应、错误、权限与外部契约。
- `.trellis/spec/database.md`：Prisma、migration、事务与数据完整性要求。
- `.trellis/spec/backend.md`：Controller/use case/repository/adapter 边界。
- `.trellis/spec/security.md`：secret、日志脱敏、高危操作审计。
- `.trellis/spec/testing.md`：公共 Interface、真实失败模式与外部边界验证。
- `.trellis/spec/cross-layer.md`：跨层状态、错误与请求追踪约束。

## Caveats / Not Found

- 本次是仓库只读审计，没有查询 2026-08-14 当前 Zeabur 环境变量、数据库、日志、服务状态或线上域名；引用的生产数据来自 2026-08-12/13 历史研究记录，可能已经变化。
- 没有读取或记录 985、IPIPD、OpenUI、NY、DNS 的生产凭据，也没有触发任何购买、资金、DNS、路由、投影或迁移写操作。
- OpenUI 源码位于计划声明的独立目录 `C:\Users\Lenovo\Desktop\3xui\OpenUI`，不在本次 `365-production` worktree 审计范围。这里只能验证控制面 Adapter 合同，不能验证 OpenUI/Xray 真实实现、限额 enforcement 或删除语义。
- 未找到 NY API 读取 Adapter、DNS observation Adapter、手工 SOCKS5 CSV/API 导入、residential exit 的协议级健康/geo quarantine、付费增加流量、批量续费/批量导出闭环。
- 未找到 `ManagedLineProjectionAdapter.delete()` 的生产调用方；未找到 `ProcessMigrationSmokeUseCase`、`ProcessMigrationCleanupUseCase` 的 Controller、Worker 或脚本调用方。
- 未找到生产代码为 SV/ZB 写入 `capabilities.inventorySource` 的管理入口；仅测试 fixture 出现该配置。
- 未运行测试、build、Prisma validate/migrate status 或浏览器 E2E；没有把现有单元测试通过等同于外部生产可用。
- 没有可引用的真实 985/IPIPD 响应样本、NY route read-back、DNS 解析、OpenUI projection read-back、SOCKS5 握手或多节点故障切换证据。因此所有对应能力即使代码存在，也保持“部分实现/无法验证”状态。
