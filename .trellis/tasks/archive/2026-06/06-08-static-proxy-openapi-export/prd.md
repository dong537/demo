# Task: OpenAPI 静态代理导出后端完善

## Goal

补齐 985Proxy-compatible OpenAPI 的静态代理导出能力，让下游分站或 API 客户可以通过 `/res_static/*` 风格接口导出自己已交付的静态代理连接信息，而不是只能走 Customer Web 使用的 `/api/proxies/export`。

## What I Already Know

- 根 PRD 在 OpenAPI 和静态能力中明确要求“导出代理连接信息”。
- 当前 Customer API 已有 `GET /api/proxies/export?format=...`，会按当前用户、站点和租户读取 ACTIVE 代理，解密密码，格式化输出，并写 `proxy.export` 审计。
- 当前 `/res_static/*` 已覆盖 business、inventory、calculate、buy、renew、order_result、order_list、ip_list、ip_detail、change_auth、switch_ip_list、switch_ip、wallet，但缺少导出入口。
- 已有 `ProxyExportFormat` 和 `formatProxyExport` 支持 `IP_PORT`、`IP_PORT_AUTH`、`AUTH_AT_IP_PORT`、`HTTP_URL`、`SOCKS5_URL`。
- OpenAPI 公开 ID 已通过 `mapProxy` 使用 `IP_<compact uuid>` 和 `ORD_<compact uuid>`。
- 当前 `.trellis/tasks/18-reseller-admin-ui/` 是未识别遗留目录，本任务不触碰、不提交。

## Requirements

- 新增 `/res_static/ip_export`（POST）接口，保持当前 `res_static` controller 的 985Proxy-compatible POST 风格。
- 请求体支持：
  - `format?: ProxyExportFormat`，默认 `IP_PORT_AUTH`。
  - `status?: ProxyStatus`，默认只导出 ACTIVE；允许显式传 status 复用列表过滤语义。
  - `country_code?: string`。
  - `search?: string`，复用代理列表搜索语义。
  - `from?: string`、`to?: string`，按 `expiresAt` 范围过滤。
- 响应 data 形状返回结构化对象：`{ format, count, lines }`，其中 `lines` 是格式化后的连接字符串数组。
- 只导出当前 APIKey/用户所属 `ownerId + siteId + tenantId` 范围内的代理；不得接受客户端传 userId、tenantId 或 siteId 作为导出权威。
- 密码只在响应映射边界解密；审计日志不得记录明文代理连接串或明文密码。
- 非法 `format` 继续返回 `VALIDATION_ERROR / proxy_export_format_invalid`。
- 非法 `from/to` 沿用 repository 行为返回 `VALIDATION_ERROR / from_invalid|to_invalid`。

## Acceptance Criteria

- [x] `POST /res_static/ip_export` 可调用 repository 查询当前用户范围内代理。
- [x] 导出默认格式为 `IP_PORT_AUTH`，支持至少 `HTTP_URL` 和 `SOCKS5_URL`。
- [x] 支持 `status/country_code/search/from/to` 过滤，且不允许客户端越权指定用户或租户。
- [x] 响应包含 `{ format, count, lines }`，行内容来自真实代理实例和解密密码。
- [x] 导出操作写 `proxy.export` 审计，审计 payload 不包含明文代理密码或完整连接串。
- [x] 非法 format / 日期参数有明确 `VALIDATION_ERROR`。
- [x] API typecheck/lint/test/build 通过。

## Technical Approach

- 在 `res-static.dto.ts` 新增 `IpExportDto`，字段采用 OpenAPI 兼容 snake_case：`country_code`，其余使用现有 body 风格。
- 在 `ResStaticController` 新增 `@Post('ip_export')`：
  - `requireTenantId(ctx)` 作为 tenant source of truth。
  - 调用 `proxiesRepo.findByUserId(ctx.ownerId, ctx.siteId, tenantId, query)`。
  - query 映射：`page=1`、`pageSize` 设为导出上限；默认 `status='ACTIVE'`。
  - 用 `parseProxyExportFormat(body.format)` 和 `formatProxyExport(...)` 生成 `lines`。
  - 调用 `ProxyAuditService.recordExport(ctx, { format, count })`。
- 若当前 repository 只有分页查询，不新增绕过分页的 DB 路径；本任务先使用受控导出上限，避免一次性无界导出。
- 新增/更新 controller 单测，mock repository、config、audit，断言查询范围、格式化输出、审计不含明文。

## Decision (ADR-lite)

**Context**: `/res_static/*` 是下游分站把本层当作上游 Provider 使用的公开接口，必须覆盖静态代理导出；已有 Customer 导出能力不能直接满足 OpenAPI 客户。  
**Decision**: 新增结构化 `POST /res_static/ip_export`，复用已有 formatter、repository 查询和 proxy audit，不引入文件流下载或单独导出存储。  
**Consequences**: 第一阶段 API 客户得到稳定 JSON 结果；后续如需要兼容 txt/csv 下载，可以在同一 formatter 后面增加响应模式，但不改变代理密码解密和审计边界。

## Out of Scope

- 不做文件流下载、CSV/Excel 二进制导出。
- 不做 Admin 跨用户导出。
- 不新增导出任务表或异步大文件导出。
- 不做批量续费、批量改密、批量切 IP。
- 不触碰 `.trellis/tasks/18-reseller-admin-ui/` 未识别目录。

## Technical Notes

- Relevant files:
  - `apps/api/src/modules/openapi/res-static.controller.ts`
  - `apps/api/src/modules/openapi/res-static.dto.ts`
  - `apps/api/src/modules/proxies/proxy-export.ts`
  - `apps/api/src/modules/proxies/proxy-audit.service.ts`
  - `apps/api/src/modules/proxies/proxies.repository.ts`
- Related specs:
  - `.trellis/spec/backend/database-guidelines.md`
  - `.trellis/spec/backend/logging-guidelines.md`
  - `.trellis/spec/guides/cross-layer-thinking-guide.md`

## Implementation Record

- `IpExportDto` 新增 OpenAPI 导出请求体，使用 `country_code` 映射到 repository `countryCode`。
- `ResStaticController` 新增 `POST /res_static/ip_export`，默认导出 ACTIVE 代理，固定同步导出上限 1000 条。
- 导出复用 `parseProxyExportFormat`、`formatProxyExport` 和 AES-GCM 解密边界，不新增第二套格式化逻辑。
- `ProxyAuditService` 通过 `ProxiesModule` 导出给 OpenAPI 模块复用，审计只记录 `{ format, count }`。
- 新增 `res-static.controller.spec.ts` 覆盖过滤映射、默认格式、HTTP_URL 输出、非法 format 和审计脱敏。
- 已回写 `.trellis/spec/backend/logging-guidelines.md`，沉淀 `/res_static/ip_export` 公开契约和审计规则。

## Verification

- `rtk pnpm --filter @ipeasy/api test -- res-static.controller.spec.ts proxy-export.spec.ts`
- `git diff --check`
- `pnpm --filter @ipeasy/api typecheck`
- `rtk pnpm --filter @ipeasy/api lint`
- `rtk pnpm --filter @ipeasy/api test`
- `rtk pnpm --filter @ipeasy/api build`
