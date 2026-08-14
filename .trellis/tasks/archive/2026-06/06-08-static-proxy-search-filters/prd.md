# Task: 静态代理搜索筛选后端完善

## Goal

补齐静态代理列表和续费搜索的后端查询语义，让 Customer/Admin 能按 IP、订单号、上游实例 ID、国家、状态、用户和到期时间范围定位代理实例，而不是前端传了参数但后端忽略。

## What I Already Know

- 根 PRD 要求“IP 续费搜索：按 IP、订单号、客户、国家、状态、到期时间定位可续费资源”。
- Customer 代理列表已经把 `search`、`countryCode`、`status` 发到 `GET /api/proxies`。
- 当前 `ProxiesRepository.findByUserId` 只按 `ip contains search` 和 `status` 过滤，忽略 `countryCode`。
- 当前 `ProxiesRepository.listForAdmin` 支持 `userId/countryCode/status`，但 `search` 只覆盖 `ip/countryCode/userId`，没有覆盖 `orderId/upstreamProxyId`。
- `PageQueryDto` 已有 `from/to`，可以作为 `expiresAt` 范围过滤，不需要新增参数。
- 当前 `.trellis/tasks/18-reseller-admin-ui/` 是未识别遗留目录，本任务不触碰、不提交。

## Requirements

- Customer `GET /api/proxies` 查询：
  - 支持 `status`。
  - 支持 `countryCode`。
  - 支持 `search` 同时匹配 `ip`、`orderId`、`upstreamProxyId`、`countryCode`。
  - 支持 `from/to` 作为 `expiresAt` 的 `gte/lte` 范围。
- Admin `GET /api/proxies` 查询：
  - 保持 `tenantId/userId/countryCode/status` 过滤。
  - 支持 `orderId` 精确过滤。
  - 支持 `search` 同时匹配 `ip`、`orderId`、`upstreamProxyId`、`countryCode`、`userId`。
  - 支持 `from/to` 作为 `expiresAt` 的 `gte/lte` 范围。
- 日期参数无效时返回明确 `VALIDATION_ERROR`，不能让 Prisma validation error 变成模糊内部错误。
- 不改变分页 envelope、密码解密、Admin 隐藏密码字段等现有行为。

## Acceptance Criteria

- [x] Repository 单元测试覆盖 Customer country/search/expiresAt 查询 where shape。
- [x] Repository 单元测试覆盖 Admin orderId/search/expiresAt 查询 where shape。
- [x] Repository 单元测试覆盖非法 `from/to` 返回 `VALIDATION_ERROR`。
- [x] Controller 原有列表 DTO 行为测试保持通过。
- [x] API typecheck/lint/test/build 通过。

## Technical Approach

- 在 `ProxiesRepository` 定义局部 `ProxyListQuery` 类型，统一 Customer/Admin 可用的查询字段。
- 抽出 `applyProxyFilters(where, query, mode)` 或同等局部 helper，避免 Customer/Admin 查询条件继续分叉。
- `from/to` 只映射到 `expiresAt`，不混淆创建时间。
- 日期校验使用 `AppError(ErrorCode.VALIDATION_ERROR, '<field>_invalid', 400)`。
- 新增 `proxies.repository.spec.ts`，mock Prisma count/findMany，断言 where/order/pagination。

## Decision (ADR-lite)

**Context**: 搜索参数已经进入前端和 controller，但 repository 只实现了部分字段。  
**Decision**: 查询语义集中在 `ProxiesRepository`，controller 只透传 query；`from/to` 在本模块内定义为 `expiresAt` 续费搜索范围。  
**Consequences**: 这次不改前端 UI；后续如果做专门“续费搜索”页面，可以复用同一后端契约。

## Out of Scope

- 不新增模糊搜索用户邮箱/订单号展示 DTO；当前只搜索已有 `proxy_instances` 字段。
- 不改订单列表搜索。
- 不做全文索引或高级排序；当前数据量下先使用 Prisma `contains`。
- 不触碰 `.trellis/tasks/18-reseller-admin-ui/` 未识别目录。

## Technical Notes

- Relevant files:
  - `apps/api/src/modules/proxies/proxies.repository.ts`
  - `apps/api/src/modules/proxies/proxies.controller.ts`
  - `apps/api/src/modules/proxies/proxies.controller.spec.ts`
  - `apps/api/src/modules/proxies/proxies.repository.spec.ts`
- Related spec:
  - `.trellis/spec/backend/database-guidelines.md`
  - `.trellis/spec/guides/cross-layer-thinking-guide.md`

## Implementation Record

- `ProxiesRepository` 新增 `ProxyListQuery` 和统一 `applyProxyFilters`，Customer/Admin 共用 status、countryCode、search、from/to 查询语义，Admin 额外支持 tenantId、userId、orderId。
- `from/to` 明确定义为 `expiresAt` 范围过滤，并在进入 Prisma 前把无效日期转换为 `AppError(ErrorCode.VALIDATION_ERROR, '<field>_invalid', 400)`。
- `search` 覆盖 IP、订单号、上游实例 ID、国家；Admin 额外覆盖 userId。
- `ProxiesController` 只透传查询契约，不承载查询语义。
- OpenAPI 静态代理兼容类型收窄，避免枚举状态在 TypeScript 下漂移。
- 新增 `proxies.repository.spec.ts` 覆盖 Customer/Admin where shape、分页参数和非法日期错误。
- 已回写 `.trellis/spec/backend/database-guidelines.md`，沉淀静态代理搜索筛选的 repository 契约和测试要求。

## Verification

- `rtk pnpm --filter @ipeasy/api test -- proxies.repository.spec.ts proxies.controller.spec.ts`
- `pnpm --filter @ipeasy/api typecheck`
- `rtk pnpm --filter @ipeasy/api lint`
- `rtk pnpm --filter @ipeasy/api test`
- `rtk pnpm --filter @ipeasy/api build`
