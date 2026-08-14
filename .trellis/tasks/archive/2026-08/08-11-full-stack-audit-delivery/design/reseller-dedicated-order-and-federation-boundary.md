# 分销专线订单与联邦上游边界

日期：2026-08-11

## 目标与范围

目标是让分销商能够审计其下级客户的专线订单，并为后续“分销商绑定自身 365Proxy APIKey 后扫描余额、库存和价格”建立可替换、可验证的边界。

本轮只实现第一部分：将一次客户专线购买写入持久的 `dedicated_line_orders` 聚合，事务性关联库存预占、钱包扣款、Provider 执行任务和最终交付的 `dedicated_lines`。分销端仅读取自己租户内的脱敏订单投影。

本轮明确不做：

- 不复用旧 `orders`、`platform_resources` 或 `upstream_api_accounts` 作为专线订单或扫描数据源。
- 不把 Provider 账号、出口 SOCKS5 凭据、节点凭据或 OpenUI Bearer token 放入分销响应。
- 不在没有 scope 强制的情况下让 APIKey 访问新的跨平台扫描接口。
- 不调用真实 Provider 下单，也不部署或修改 NY/DNS/3x-ui。

## Source of Truth 与数据流

`dedicated_line_orders` 是客户下单时的不可变商业快照：SKU、国家/可选业务属性、时长、数量、单价、总价、币种、报价来源、报价契约版本和幂等键。它不是 Provider 回执，也不是交付状态的副本。

下单数据流：

`catalog quote -> dedicated_line_orders -> stock_reservations + ledger_entries -> external_jobs(PROVIDER_DEDICATED_LINE_ORDER) -> dedicated_lines -> projections/routes`

- `dedicated_line_orders`、`stock_reservations`、钱包账本和 Provider job 必须在同一数据库事务中创建。
- Provider job 仍是执行状态的权威来源；线路聚合及其 projection/route 是交付状态的权威来源。订单列表返回两者的脱敏摘要，而不复制或猜测状态。
- 退款仍以 reservation/ledger 幂等键为权威；订单快照不直接改写金额。

## 模块与契约

- `dedicated-line-orders`：创建订单快照、库存预占、扣款和任务的原子 use case；Provider 完成时把每条创建的 `dedicated_lines` 关联到同一订单。
- `customer-reseller`：只按 `siteId + tenantId` 查询 `dedicated_line_orders`，可按下级 `userId` 和执行状态过滤；响应只含 SKU、客户、商业快照、Provider job 状态和线路状态计数。
- 前端 `reseller-orders`：从新投影读取专线 SKU、国家、时长、金额和真实状态；不再把历史静态代理字段渲染为专线订单。

新的内部接口约束：库存预占输入必须携带不可变 `orderSnapshot`，并在创建 reservation/job 前持久化订单。Provider completion 必须要求 job 关联订单，创建的每个 line 必须带同一 `dedicatedLineOrderId`。

错误语义：无订单关联的 Provider job 是数据不变量错误，进入可见的 `NEEDS_OPERATOR` 路径，不会静默创建不可审计线路。分销商跨租户读取维持 404/空集边界，不以客户端过滤替代数据库条件。

## 后续联邦扫描边界

当前 APIKey strategy 只校验身份、IP 白名单和 ownerType，未强制 `scopes`；因此不能直接把它作为分销商调用上游 365Proxy 的授权模型。

后续需要单独实现：

1. 平台专线 OpenAPI 的 scope guard，例如 `dedicated:catalog:read`、`dedicated:wallet:read`、`dedicated:orders:write`，并为每个 endpoint 进行真实 APIKey scope 集成测试。
2. 分销租户 owner 绑定的加密 `federated_upstream_connections`，其中 365Proxy APIKey 只用于远端请求，永不回显；扫描结果带 `capturedAt`、过期时间和远端错误，不把本地缓存伪装成实时数据。
3. 第三方 APIKey 使用独立 adapter 与 capability contract。它不能借用旧静态代理 `upstream_api_accounts`，也不能读取/写入平台 Provider 或线路出口凭据。

## 验证

- Red: 真实 PostgreSQL 集成测试先证明下单前不存在持久专线订单，并期望新订单/预占/job/账本/最终 lines 具有一致关联；分销租户订单列表不读取 legacy `orders`，也不返回 Provider 或出口字段。
- Green: Prisma migration、API typecheck、专线订单与分销订单相关集成测试、前端订单 feature 测试与 typecheck/lint/build。
- 残余风险：真实 APIKey 联邦扫描、第三方 adapter、Zeabur 与真实外部线路 smoke 尚未执行，不宣称在线交付。
