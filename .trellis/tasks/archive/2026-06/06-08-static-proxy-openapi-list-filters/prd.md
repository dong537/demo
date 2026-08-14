# Task: OpenAPI 静态 IP 列表筛选后端完善

## Goal

补齐 `/res_static/ip_list` 的筛选参数映射，让 985Proxy-compatible OpenAPI 客户可以按国家、搜索词和到期时间范围查询自己已购静态代理；避免 repository 已支持筛选但 OpenAPI 入口仍只透传 `status`。

## What I Already Know

- 根 PRD 要求 OpenAPI 覆盖已购 IP 列表，并支持按 IP、订单号、国家、状态、到期时间搜索续费对象。
- `ProxiesRepository.findByUserId` 已支持 `status/countryCode/search/from/to`，且 `from/to` 映射到 `expiresAt`。
- 当前 `ResStaticController.ipList` 只从 body 映射 `page/page_size/status`。
- 刚完成的 `/res_static/ip_export` 已使用 `country_code/search/from/to` 映射同一套 repository 查询语义。
- 当前 `.trellis/tasks/18-reseller-admin-ui/` 是未识别遗留目录，本任务不触碰、不提交。

## Requirements

- 扩展 `IpListDto`：
  - `country_code?: string`
  - `search?: string`
  - `from?: string`
  - `to?: string`
- `POST /res_static/ip_list` 查询必须映射：
  - `country_code` -> repository `countryCode`
  - `search` -> repository `search`
  - `from/to` -> repository `from/to`
  - 保持现有 `page/page_size/status`
- 查询范围仍只能来自 `ctx.ownerId + ctx.siteId + requireTenantId(ctx)`，不得允许 body 覆盖用户、站点或租户。
- 非法 `from/to` 沿用 repository 返回 `VALIDATION_ERROR / from_invalid|to_invalid`。
- 响应结构保持现有 `mapPage(...mapProxy...)`，不改变 985Proxy-compatible envelope。

## Acceptance Criteria

- [x] `POST /res_static/ip_list` 会把 `country_code/search/from/to` 传给 `ProxiesRepository.findByUserId`。
- [x] 现有 `page/page_size/status` 行为保持不变。
- [x] 响应代理 DTO 仍使用 `mapProxy`，密码只在响应映射边界解密。
- [x] 单元测试覆盖筛选映射和非法日期由 repository 前置抛出时不被吞掉。
- [x] API typecheck/lint/test/build 通过。

## Technical Approach

- 在 `IpListDto` 增加 OpenAPI body 字段，不新增新 endpoint。
- 在 `ResStaticController.ipList` 复用 `/res_static/ip_export` 同名字段映射风格。
- 新增/扩展 `res-static.controller.spec.ts`，mock repository，断言 `findByUserId` 参数和错误传播。
- 不在 controller 里重新实现日期校验，保持 repository 是代理筛选语义的 source of truth。

## Decision (ADR-lite)

**Context**: repository 已经统一了 Customer/Admin 的代理筛选语义，但 OpenAPI `ip_list` 入口没有把 body 字段接进去。  
**Decision**: 在 `/res_static/ip_list` 只做 snake_case -> camelCase 的边界映射，筛选规则继续由 repository 负责。  
**Consequences**: OpenAPI 客户和 Customer Web 走同一套后端搜索语义；后续批量续费或分站上游查询可以复用同样参数。

## Out of Scope

- 不新增 Admin 跨用户 OpenAPI 列表。
- 不修改 `/res_static/switch_ip_list`。
- 不新增排序、批量导出或全文索引。
- 不触碰 `.trellis/tasks/18-reseller-admin-ui/` 未识别目录。

## Technical Notes

- Relevant files:
  - `apps/api/src/modules/openapi/res-static.controller.ts`
  - `apps/api/src/modules/openapi/res-static.dto.ts`
  - `apps/api/src/modules/openapi/res-static.controller.spec.ts`
  - `apps/api/src/modules/proxies/proxies.repository.ts`
- Related specs:
  - `.trellis/spec/backend/database-guidelines.md`
  - `.trellis/spec/backend/logging-guidelines.md`
  - `.trellis/spec/guides/cross-layer-thinking-guide.md`

## Implementation Record

- `IpListDto` 新增 `country_code/search/from/to`，与 `/res_static/ip_export` 保持一致的 OpenAPI body 风格。
- `ResStaticController.ipList` 将 snake_case body 映射为 repository query：`country_code -> countryCode`，并透传 `search/from/to`。
- 响应仍走 `mapPage(...mapProxy...)`，密码只在响应映射边界解密。
- `res-static.controller.spec.ts` 新增 `ipList` 单测，覆盖筛选映射、公开 ID 映射、密码解密和 repository 校验错误传播。
- 已回写 `.trellis/spec/backend/database-guidelines.md`，沉淀 `/res_static/ip_list` body 签名和测试点。

## Verification

- `rtk pnpm --filter @ipeasy/api test -- res-static.controller.spec.ts proxies.repository.spec.ts`
- `git diff --check`
- `pnpm --filter @ipeasy/api typecheck`
- `rtk pnpm --filter @ipeasy/api lint`
- `rtk pnpm --filter @ipeasy/api test`
- `rtk pnpm --filter @ipeasy/api build`
