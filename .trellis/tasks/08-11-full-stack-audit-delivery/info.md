# 当前技术设计索引

已确认的架构契约：`.trellis/tasks/08-11-full-stack-audit-delivery/design/active-active-dedicated-line-control-plane.md`

执行计划：`docs/superpowers/plans/2026-08-11-365proxy-full-delivery.md`

下方内容是确认主动-主动架构前形成的基础范围记录，仅保留为研究历史。它不能覆盖或替代上方的
完整设计与实施计划。

## 历史基础范围

本阶段只建立可独立验证的专线控制面基础，不把未完成 UI 暴露给用户。PostgreSQL 保存
`dedicated_lines` desired state、`residential_exits`、`control_nodes` 和每节点
`dedicated_line_projections` observed state；SKU 首批固定为 `SV`/`ZB`，家宽资源不进入可售池。
NY 转发规则不由平台写入，平台只保存管理员导入的 route/domain 快照和版本。3x-ui HTTP API 被
封装成窄 Adapter；worker 只负责 claim 和受控并发调度，业务状态变化留在后端 use case/repository。

现有静态代理订单和 `proxy_instances` 仅保留历史读取与必要的管理补偿；客户、管理员和 OpenAPI 的
`STATIC_PROXY_BUY` 创建入口统一返回 `PRODUCT_DISABLED / static_proxy_purchase_disabled / 410`。
后续阶段通过明确订单/专线关联进入新域，不会用兼容读取、默认值或旧购买 use case 让旧模型冒充专线。

关键验证：Prisma migration、状态机、site/tenant/user scope、lease owner + desired version 条件更新、
3x-ui Bearer auth 脱敏、read-after-write、受控并发和进程重启恢复。第一阶段只实现有官方
接口证据的 client projection；后续补齐用于住宅 SOCKS 出口的 outbound/route projection，并
单独实现 NY 导入校验，不建立 NY 写入 Adapter。
没有真实 3x-ui 凭据时只能完成 Adapter contract 测试，不能宣称线上专线已交付。

## Phase 3 进展（2026-08-11）

已实现并验证专线库存闸门与 Provider 异步订单骨架：

- `dedicated_line_inventory_snapshots` 增加显式 `providerResourceId` 与原子
  `reservedQuantity`；库存同步只接受 SKU `capabilities.inventorySource` 中声明的
  Provider 资源映射，不猜测 SK5 或把家宽库存转成专线库存。
- 客户 `POST /api/dedicated-line-orders` 只接受 SKU、国家、数量、时长、币种、幂等键和
  副本扇出；服务器内部选择 fresh route、原子预占库存并创建 `external_jobs`，响应不泄漏
  Provider 账号、资源 ID 或出口凭据。
- 并发预占、幂等重放、映射隔离和无库存零 Provider 副作用均使用真实 PostgreSQL 集成测试
  验证；库存不足/无路由写入去重的 `alerts.bark.inventory_low` outbox 事件。
- Provider worker 使用租约、退避和受控并发；租约过期进入 `NEEDS_OPERATOR`，不对非幂等的
  上游购买盲目重试。订单完成前校验 SOCKS5、国家、数量、端口和凭据，并把出口凭据加密入库。
- 985 静态 API 已按官方字段 `static_proxy_type/time_period/pay_type/buy_data` 对接，
  SOCKS5 优先使用 `port_socks`，异步查询在响应缺少 `zone` 时使用订单国家兜底。

本阶段仍未完成：Bark outbox 实际 HTTP 投递与失败重试、Provider 生产下单开关和真实凭据，
出口到 `dedicated_lines`/3x-ui/Xray 的配置投影，NY 域名导入、资金扣款/报价快照、客户/管理
员/Reseller UI，以及 Zeabur/线上 E2E。当前证据不能宣称专线已线上交付。

## Phase 4 进展（2026-08-11）

Bark 库存告警投递已补齐：`AlertsModule` 提供官方 `/push` JSON client、outbox lease/retry
repository、实际投递 use case 和独立 worker。设备 key 只由 `BARK_DEVICE_KEYS` 运行时注入，
生产启用时 ConfigGuard 强制至少配置一个 key；库存告警正文不包含任何 Provider 凭据。
429/5xx 会有限重试，超时、网络异常和租约过期进入 `NEEDS_OPERATOR`，避免不确定结果造成无限
重复通知。客户端测试、worker 测试和真实 PostgreSQL outbox 集成测试已通过。

Phase 4 仍未完成 Provider 真实下单 smoke、3x-ui/Xray 投影、资金 Saga、UI、NY 导入、部署和线上
验收；Bark 只有在部署环境显式开启并注入管理员设备 key 后才会发出真实通知。

## Phase 5 OpenUI 托管线路投影（2026-08-11）

在独立 worktree `C:\Users\Lenovo\Desktop\3xui\OpenUI\.worktrees\managed-line-projection` 完成并提交 `a923190c`：

- 新增 Bearer API：`GET/PUT/DELETE /panel/api/managed-line-projections/:projectionKey`。PUT 只接受已有入站标签、VLESS/VMess/mixed 客户、SOCKS5 出口和生命周期限制，不接受整份 Xray JSON；响应不返回客户或出口凭据。
- OpenUI SQLite 新增 `managed_line_projections` 运行时投影表。365Proxy PostgreSQL 仍是订单和 desired state 的事实源；OpenUI 只保存本节点的 owned tags、版本、哈希、投影片段和脱敏错误。
- 投影使用 `365-managed-out-*`/`365-managed-rule-*` ownership tag。相同版本和哈希幂等；旧版本或同版本漂移冲突；删除只允许删除本投影拥有的客户、出口和规则。
- Xray gRPC 增加 outbound/rule/list/read-back 能力。由于 Xray `AddRule(shouldAppend=false)` 会替换完整规则表，实际 reconcile 采用 SQLite 投影写入、从权威配置安全合并并把受管规则前置、重启 Xray、gRPC 读回校验的补偿流程，避免覆盖人工规则。
- 失败会恢复入站、客户流量行和旧投影；恢复失败进入 `NEEDS_OPERATOR`。生命周期 `enabled=false` 会保留 desired 客户但不强制要求运行时用户存在；禁用目标入站会拒绝投影。

验证：OpenUI `go test ./...`、`go vet ./...` 和 API 文档路由检查通过。OpenUI 前端依赖安装因 npm registry 网络超时未完成；本次只改 API 文档 JS，使用现有 `web/dist` 进行 Go embed 测试。尚未连接真实 3x-ui/Xray 节点或执行线上协议 smoke，不能标记线路已交付。
# 2026-08-11 Reseller 专线 SKU 目录与定价闭环

本轮将 Reseller 的可售商品、启停和模板价规则从历史 `platform_resources/price_rules`
切换为专线权威模型 `service_skus/sku_price_rules`。Reseller 租户（`ownerUserId` 非空）不会再
继承站点默认 SKU 价：下级客户只能看到并报价已由 Reseller 模板或其专属覆盖显式启用的 SKU。
普通租户仍保持站点默认价的既有行为。商品列表只返回 SKU 合约和版本化专线库存摘要，不返回
Provider、出口或凭据字段。

已验证：真实 PostgreSQL 集成覆盖 SKU 启用、客户目录、分销价报价和停用后的报价拒绝；前端
商品/模板测试、API/Web typecheck/lint/build 均通过。尚未完成 Reseller 自助上游 APIKey 绑定、
余额/库存实时扫描、下级专线订单 facade 和 Zeabur/真实节点外部验收。

## 2026-08-11 专线订单聚合与分销订单投影

新增 `dedicated_line_orders` 作为一次专线购买的不可变商业事实源，保存 SKU 名称/代码、国家、时长、
数量、单价、总价、币种、报价来源和报价契约版本。该记录与库存预占、钱包扣款和 Provider job 在
同一 PostgreSQL 事务内创建；幂等重放会比较完整商业快照，价格或时长改变时返回冲突。Provider
完成后创建的每条 `dedicated_lines` 都关联原订单，缺少订单关联的 job 不再静默创建不可审计线路。

Reseller 概览、客户订单数和订单列表已从历史 `orders` 切换到专线订单聚合。列表只返回下级客户、
SKU 快照、金额、Provider job 状态和线路状态计数，不返回 Provider 账号、资源映射、出口地址或凭据。
前端订单页同步切换到专线 SKU/国家/执行状态，删除静态代理字段与格式化路径。

验证证据：独立 `ipipx_test` PostgreSQL 数据库应用 16 个 migration；4 个专线/分销集成测试文件
共 14 个用例通过；分销订单前端测试、API/Web typecheck 通过。完整 lint/build 与 migration
幂等检查在本阶段结束前再次执行。后续联邦上游 APIKey 设计见
`design/reseller-dedicated-order-and-federation-boundary.md`；scope guard、真实余额/库存/价格扫描和
第三方 adapter 仍未实现。

## 2026-08-11 Reseller 联邦上游凭据与扫描

新增独立 `federated_upstream_connections` / `federated_upstream_scans` 模型。Reseller 只能在
自有租户范围内创建、更新、扫描和停用连接；凭据使用 `APP_ENCRYPTION_KEY` 的 AES-GCM 加密保存，
列表与响应只返回配置状态和指纹，不回显密文或明文。连接名称在站点/租户内唯一，重复创建返回
`federated_upstream_name_taken / 409`。

联邦 adapter 已接入 365 专线只读 OpenAPI、985Proxy 现有库存/成本 adapter 与流量余额接口、
ipipd 现有库存/成本 adapter 与签名账户余额接口。扫描结果保存余额、库存、报价、采集时间和过期时间；
Reseller 列表只展示余额和条数摘要，不泄漏 Provider 资源 ID。365 APIKey 默认使用 `dedicated:*`，
旧 `res_static:*` 仅作为降级只读预设；专线 OpenAPI 通过 `dedicated:*` scope guard，缺少报价权限时
扫描失败而不会伪装成无价格。

前端新增 `/reseller/connections` 上游连接工作台，支持 365/985Proxy/ipipd 凭据输入、脱敏列表、扫描、
停用和错误反馈。真实 PostgreSQL 集成验证加密保存、租户隔离、重复名称冲突和扫描摘要；API adapter、
scope guard、Web 组件与 APIKey 组件测试通过。尚未完成 Zeabur 部署确认、第三方真实凭据扫描和真实
3x-ui/Xray/NY 线路 smoke，不得据此宣称线上专线已交付。
