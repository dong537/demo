# Phase 1 后端前置验证记录

日期：2026-08-11

## 本批次范围

- 扩展 `service_skus` 为带 `capabilities`、`contractVersion`、可见性和排序的可扩展专线 SKU 契约。
- 新增独立 SKU 价格表，复用现有 template/binding 的所有权关系，不把 SKU 伪装成 `platform_resources`。
- 增加客户/管理员只读 catalog 与 quote API；报价返回可供后续订单保存的不可变值对象，但不实现订单 Saga。
- 幂等 upsert 首批 `SV`、`ZB`，不写入任何猜测的 985 SK5 映射或价格。
- 禁用客户、管理员和 `/res_static/buy` 的 `STATIC_PROXY_BUY` 创建路径；历史订单/代理 GET 保留。

明确不做：UI、OpenUI、Provider HTTP、985/IPIPD 调用、SK5 字段猜测、生产迁移、生产 seed、专线下单 Saga。

## Source of Truth 与数据流

```text
service_skus + SKU price tables
  -> CatalogRepository (site/tenant/user scope)
  -> SkuQuoteUseCase (fixed priority + Decimal arithmetic)
  -> customer/admin catalog and quote API
```

价格优先级固定为：

```text
USER_OVERRIDE
  -> USER_TEMPLATE
  -> TENANT_DEFAULT_TEMPLATE
  -> SITE_OVERRIDE
  -> SITE_DEFAULT_TEMPLATE
```

报价只读 PostgreSQL。它不读取旧 `platform_resources`，不检查/同步 Provider 库存，不产生外部副作用。
库存 reservation、扣款、Bark 和 Provider buy 仍属于后续专线订单 Saga。

## API 契约

- `GET /api/catalog/skus`
- `GET /api/catalog/admin/skus`
- `GET /api/catalog/quote`
- `GET /api/catalog/admin/quote`
- `POST /api/orders/static-proxy` -> HTTP 410
- `POST /api/orders/users/:userId/static-proxy` -> HTTP 410
- `POST /res_static/buy` -> HTTP 410，兼容 envelope 为
  `{ code: "PRODUCT_DISABLED", msg: "static_proxy_purchase_disabled", data: null }`

旧静态购买 use case 已从 Nest DI 图移除并删除；订单、代理和 OpenAPI 历史读取路径未删除。

## TDD 证据

- RED 1：4 个 suite 因 `catalog/domain`、`sku-seed`、`static-purchase-disabled` 尚不存在而失败。
- GREEN 1：4 个 suite、7 个测试通过。
- RED 2：`PRODUCT_DISABLED` 尚不存在，三类静态购买入口仍进入旧创建/校验逻辑，catalog controller 尚不存在。
- GREEN 2：6 个 suite、13 个测试通过。
- RED 3：quote 顶层未冻结，`Object.isFrozen(quote)` 失败；修复后通过。
- RED 4：catalog 响应透传内部 `siteId`；增加显式 DTO 投影后通过。
- RED 5：管理员可组合错误的 `tenantId + userId` 请求报价；增加 repository buyer scope 校验后，
  跨租户目标在读取 SKU/价格前返回 `NOT_FOUND / user_not_found`。

## 实际验证结果

- `pnpm --filter @ipeasy/db generate`：通过。
- `pnpm --filter @ipeasy/db build`：通过。
- `pnpm --filter @ipeasy/api typecheck`：通过。
- `pnpm --filter @ipeasy/api lint`：通过。
- catalog、静态禁售、OpenAPI envelope、专线状态机和 external lease 聚焦测试：9 个 suite、33 项通过。
- 可丢弃 PostgreSQL 16：14 个 migration 首次完整执行通过；第二次 `migrate deploy` 明确返回
  `No pending migrations to apply`。
- `seed:line-skus` 在同一 site 连续执行两次均通过；最终查询为 `2|SV,ZB`，没有重复 SKU。
- 真实 PostgreSQL catalog integration：2 项通过，覆盖客户目录/报价/DTO 脱敏和管理员错误 tenant/user scope。
- 旧 purchase-flow integration 中，家宽购买禁售与零副作用用例通过；同文件其余 8 个旧静态报价用例仍因
  恢复基线已记录的 Provider 账号夹具漂移失败，失败均发生在旧 `/api/pricing/quote`，不经过新 catalog。
- 全仓 `pnpm typecheck`、`pnpm lint`、`pnpm build`、`git diff --check`：通过。
- 全仓 `pnpm test`：API 381 项中 373 通过、8 项失败；失败限定在
  `proxy-lifecycle.service.spec.ts`（5）和 `fulfill-static-proxy.use-case.spec.ts`（3），与恢复基线记录一致。
  worker 11 项通过；Turbo 在 API 失败后终止，web 全量测试未完成。

## 尚未验证/有意留空

- 未对生产数据库执行 migration 或 seed；本批次只使用并已销毁隔离 PostgreSQL 容器。
- 没有提供 SV/ZB 的实际售价，因此没有编造默认价格；未配置 SKU 价格时 quote 明确返回 `PRICE_MISSING / no_sku_price_rule`。
- 未宣称全量 integration suite 通过；旧静态报价夹具漂移仍需单独修复，新的 catalog integration 已使用真实 PostgreSQL。
- `fast-context` 在当前工具集中不可用，本批次按一次性降级记录使用 `rg`、schema 与调用链阅读。

## Phase 3 库存闸门与异步订单验证（2026-08-11）

### 已实现边界

- 专线库存快照按 `siteId + providerAccountId + skuId + countryCode + providerResourceId + sourceVersion`
  唯一标识，`reservedQuantity` 由数据库条件更新维护；Provider 资源必须由 SKU 的
  `capabilities.inventorySource` 显式声明。
- 客户下单路由由服务端从 fresh 快照选择，客户端不得传 Provider 账号或资源；原子预占成功后才
  创建 `PROVIDER_DEDICATED_LINE_ORDER` 外部任务。重复幂等键只重放已有任务。
- 无 fresh 路由或数量不足时写入去重 Bark outbox，不创建 Provider 任务；这只代表事件已持久化，
  不是 Bark 已成功发送。
- worker 通过数据库租约和 `Promise.allSettled` 受控并发执行；租约过期进入 `NEEDS_OPERATOR`，
  避免对可能已被上游接受的非幂等购买重复调用。
- 985 官方静态下单字段和 SOCKS5 端口映射已覆盖；异步查询保留订单国家兜底。真实 985/IPIPD
  生产凭据未写入代码或数据库。

### 实际验证

- 新 PostgreSQL 16 容器从零执行 14 个 migration：通过；Prisma generate/validate：通过。
- `dedicated-line-inventory-repository-integration.spec.ts`：3 项通过，覆盖并发库存闸门、幂等
  重放、显式 Provider 资源映射和 fresh route。
- `dedicated-line-orders-api-integration.spec.ts`：2 项通过，覆盖客户不传内部路由字段和无 fresh
  路由的零 Provider 副作用。
- 专线 domain、ConfigGuard、985 SOCKS5/国家兜底、worker 并发/禁用/租约恢复聚焦测试通过；
  API/worker typecheck 与 lint 通过。

### 残余风险

- Bark outbox publisher 的原始缺口已在下方 Phase 4 补齐；真实通知仍要求部署环境显式注入
  管理员设备 key 并开启 `BARK_ALERTS_ENABLED`，本地测试不调用外部 Bark。
- Provider 适配器的生产下单执行仍受 `DEDICATED_LINE_ORDER_EXECUTION_ENABLED=false` 和
  allowlist 保护；未做真实扣款/上游订单 smoke test。
- Provider 出口尚未投影为 3x-ui/Xray inbound/outbound/route，住宅出口成功也不能等同于客户线路
  已交付。

## Phase 4 Bark outbox 投递验证（2026-08-11）

- 客户端按 Bark 官方 API V2 的 `/push` JSON 契约发送 `title/body/group/device_keys/level`；
  `BARK_SERVER_URL` 支持官方服务或受控自托管地址，设备 key 从 secret 环境变量读取。
- `BarkAlertOutboxRepository` 使用 `PENDING/RETRYING -> LEASED` 条件更新、attempt 递增、
  `PUBLISHED/FAILED/NEEDS_OPERATOR` 状态和 lease recovery；没有把通知成功写成 Provider/订单成功。
- 429/5xx 被视为可重试 HTTP 失败；超时和网络错误是结果不确定，进入 `NEEDS_OPERATOR`，不做
  自动重复发送。事件 payload 缺字段进入终态 `FAILED`。
- 客户端 3 项、worker 2 项、ConfigGuard 7 项测试通过；真实 PostgreSQL outbox lease/publish/
  expired-lease 集成 2 项通过。
