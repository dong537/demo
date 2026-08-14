# 完善规范并审计购买与上游同步链路

## Goal

完善 Bootstrap Guidelines 中和交易链路、上游同步相关的可执行规范，并对当前项目的静态代理购买、扣款、履约交付、失败退款、上游库存同步链路做一次真实代码审计。目标不是继续堆功能，而是把“能不能购买、为什么没资源、同步是否真实成功、失败是否可见”这些 P0 风险收敛到明确契约、代码修复和可运行验证上。

## What I Already Know

* 用户要求继续完善 Bootstrap Guidelines，并检查购买/扣款/交付链路、上游同步。
* 用户此前多次强调不要 mock、功能必须真实可用、同步失败不能显示成功。
* 本项目使用 Trellis，相关规范位于 `.trellis/spec/`，任务上下文位于 `.trellis/tasks/`。
* 交易链路疑似关键文件：
  * `apps/api/src/modules/orders/use-cases/create-static-proxy-order.use-case.ts`
  * `apps/api/src/modules/fulfillment/use-cases/fulfill-static-proxy.use-case.ts`
  * `apps/api/src/modules/wallet/wallet.repository.ts`
  * `apps/worker/src/main.ts`
* 上游同步疑似关键文件：
  * `apps/api/src/modules/resources/use-cases/sync-inventory.use-case.ts`
  * `apps/api/src/modules/providers/provider-registry.service.ts`
  * `apps/api/src/modules/providers/adapters/*.adapter.ts`
  * `apps/worker/src/inventory-sync-worker.ts`
* 当前任务不做线上部署，不真实向上游下单。

## Assumptions

* “Bootstrap Guidelines”指 `.trellis/spec/` 和已有 bootstrap task/spec 中缺失或过弱的工程规范。
* 审计可以通过本地代码、类型、测试、DB schema、必要的非下单上游连通/同步接口来完成。
* 如果发现 P0 缺陷，优先做窄修复并补测试；如果缺陷影响面太大，则记录为明确 follow-up，不用大重写掩盖风险。

## Requirements

* 购买链路必须明确 source of truth：价格、余额、订单、履约任务、交付凭据、退款流水分别由哪个模块拥有。
* 扣款、建单、创建履约任务必须具备事务一致性和幂等语义，不能并发透支或跨用户幂等冲突。
* 履约结果必须对 worker/API 可见，不能靠吞异常表达失败或成功。
* 失败退款必须可审计，不能静默退款或重复退款。
* 上游同步必须返回可解释结果：尝试、创建、更新、跳过、失败、上游原始状态或错误摘要；0 条同步不能被包装成成功。
* 前端/接口展示的同步结果必须基于真实 API 结果，不能 mock 或假成功。
* Bootstrap Guidelines 需要沉淀上述契约，作为后续开发门槛。

## Acceptance Criteria

* [ ] PRD、任务上下文和相关 spec 已补齐交易链路与上游同步契约。
* [ ] 已审计购买 -> 扣款 -> 建单 -> worker 履约 -> 交付 -> 失败退款的真实代码路径。
* [ ] 已审计 provider 连通测试、库存同步、国家/平台映射、同步结果展示的真实代码路径。
* [ ] 发现的可控缺陷已窄修复并补测试；暂不修复的问题写入任务风险或 follow-up。
* [ ] 相关 API/worker 测试、typecheck 或可替代验证已运行并记录结果。

## Out of Scope

* 不部署 Railway。
* 不真实购买上游代理，不产生真实订单消费。
* 不做新一轮整体 UI 视觉重构。
* 不引入 mock、内存 DB、假 provider 或生产 fallback。
* 不做无计划大重写。

## Technical Notes

* 先读 `.trellis/spec/backend/index.md`、`.trellis/spec/frontend/index.md`、`.trellis/spec/guides/index.md` 及相关 guideline，再进入代码修改。
* 需要重点检查 Prisma schema 中订单幂等约束、钱包表约束、履约任务状态机、资源同步表结构。
* 如果 syncInventory 当前只返回 `{ synced }`，需要升级为可审计的结果结构，并同步 API/前端/测试。
* 如果 worker 履约 use case 内部 catch 后不返回明确状态，需要改为类型化履约结果，保留 worker 统一统计/告警入口。

## Implementation Notes

* Order idempotency is already scoped by `siteId + tenantId + userId + idempotencyKey` in Prisma schema and migration `20260612120000_scope_order_idempotency`.
* Purchase flow already reads wallet, debits ledger, creates order, creates fulfillment job, and writes audit inside one Prisma transaction.
* Wallet debit now adds a database update predicate `available >= amount` in addition to the version check.
* Fulfillment use case already returns typed worker-visible results: `NOOP`, `COMPLETED`, `RETRYING`, `FAILED_REFUNDED`.
* Inventory sync already returns auditable counts and throws `inventory_empty` on zero upstream items.
* Proxy-Seller health check was corrected to call `reference/list/resident` and verify a resident tariff id, matching the real sync/buy prerequisite.
* Customer static proxy purchase now treats React Query as the resource-list server-state cache; feature-level module caches were removed to prevent stale cross-test/session data.
* Returned unpriced static proxy resources stay visible as disabled/unpriced SKUs, never render placeholder prices, and never call the pricing quote endpoint.
* Static proxy purchase copy now exposes city/line previews plus priced/unpriced SKU counts through i18n keys.
* Customer wallet ledger rows now translate backend reason keys into readable business actions and show only a short transaction suffix in the main row.
* Customer static proxy purchase now loads a bounded first resource page (`pageSize=300`) instead of requesting 5000 SKUs on entry; backend search remains part of the React Query key for country/city/line lookups outside the first page.
* Authenticated customer/admin shells now use the IPIPD logo/blue-white shell treatment from the crawled public assets instead of exposing the old IPEasy admin mark.
* Backend public resource listing now paginates saleable resources in Prisma before price resolution, so the customer purchase first page no longer prices every saleable resource before slicing.
* Backend public/admin resource search now expands customer-facing localized country/city aliases such as `纽约`, `新加坡`, and `美国` into real `platform_resources` code/name/displayName/providerCode conditions before DB pagination.
* Customer public purchase listing now shows configured visible/saleable/priced resources even when local inventory snapshots are zero, stale, or missing; backend quote/order remains the real-time inventory authority and returns visible failures.

## Verification Log

* PASS: `pnpm --filter @ipeasy/api test -- src/modules/providers/tests/pr-adapter.spec.ts src/modules/resources/use-cases/sync-inventory.use-case.spec.ts src/modules/providers/tests/provider-country-coverage.spec.ts`
* PASS: `pnpm --filter @ipeasy/worker test -- src/inventory-sync-worker.spec.ts src/main.spec.ts`
* PASS: `pnpm --filter @ipeasy/api typecheck`
* PASS: `pnpm --filter @ipeasy/worker typecheck`
* PASS with local DB env: `$env:DATABASE_URL_TEST='postgresql://ipipx:ipipx@localhost:15432/ipipx'; $env:DATABASE_URL=$env:DATABASE_URL_TEST; pnpm --filter @ipeasy/api test:integration -- src/modules/orders/tests/purchase-flow-integration.spec.ts src/modules/orders/tests/admin-customer-order-integration.spec.ts src/modules/orders/tests/admin-order-ops-integration.spec.ts`
* PASS: `pnpm --filter @ipeasy/web test -- src/features/customer-proxies/tests/customer-proxy-flow.spec.tsx --reporter=verbose`
* PASS: `pnpm --filter @ipeasy/web test -- src/features/wallet/tests/customer-wallet.spec.tsx --reporter=verbose`
* PASS: `pnpm --filter @ipeasy/web test`
* PASS: `pnpm --filter @ipeasy/web typecheck`
* PASS: `pnpm --filter @ipeasy/web lint`
* PASS: `node --test e2e/start-web.test.cjs`
* PASS: `pnpm --filter @ipeasy/web build`
* PASS 2026-06-18 resource-load/brand pass: `pnpm --filter @ipeasy/web test -- src/features/customer-proxies/tests/customer-proxy-flow.spec.tsx --reporter=verbose`
* PASS 2026-06-18 resource-load/brand pass: `pnpm --filter @ipeasy/web typecheck`
* PASS 2026-06-18 resource-load/brand pass: `pnpm --filter @ipeasy/web lint`
* PASS 2026-06-18 resource-load/brand pass: `pnpm --filter @ipeasy/web build`
* PASS 2026-06-18 resource-load/brand pass: `pnpm --filter @ipeasy/web test`
* PASS 2026-06-18 resource-load/brand pass: `node --test e2e/start-web.test.cjs`
* PASS 2026-06-18 localized resource search pass: `pnpm --filter @ipeasy/api test -- src/modules/resources/resources.repository.spec.ts --reporter=verbose`
* PASS 2026-06-18 localized resource search pass: `pnpm --filter @ipeasy/api test -- src/modules/resources/resources.repository.spec.ts src/modules/resources/resources.controller.spec.ts --reporter=verbose`
* PASS 2026-06-18 localized resource search pass: `pnpm --filter @ipeasy/api typecheck`
* PASS 2026-06-18 localized resource search pass: `pnpm --filter @ipeasy/api lint`
* PASS 2026-06-18 localized resource search pass: `pnpm --filter @ipeasy/api build`
* PASS 2026-06-19 configured purchase catalog pass: `pnpm --filter @ipeasy/api test -- src/modules/resources/resources.repository.spec.ts --reporter=verbose`
* PASS 2026-06-19 configured purchase catalog pass: `pnpm --filter @ipeasy/web test -- src/features/customer-proxies/tests/customer-proxy-flow.spec.tsx --reporter=verbose`
* PASS 2026-06-19 configured purchase catalog pass: `pnpm --filter @ipeasy/api typecheck`
* PASS 2026-06-19 configured purchase catalog pass: `pnpm --filter @ipeasy/web typecheck`
* PASS 2026-06-19 configured purchase catalog pass: `pnpm --filter @ipeasy/api lint`
* PASS 2026-06-19 configured purchase catalog pass: `pnpm --filter @ipeasy/web lint`
* PASS 2026-06-19 configured purchase catalog pass: `pnpm --filter @ipeasy/api build`
* PASS 2026-06-19 configured purchase catalog pass: `pnpm --filter @ipeasy/web build`
* PASS 2026-06-19 configured purchase catalog pass: `node --test e2e/start-web.test.cjs`
