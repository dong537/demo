# Task: 静态代理生命周期与导出体验

## Goal

把“我的静态代理”从只能查看/复制单条，推进到可导出、可搜索、可执行生命周期操作的真实链路；同时补齐后端保存上游代理实例标识的能力，使 Reseller / UPSTREAM_API 模式具备续费、改密、切 IP 的真实转发基础。

## What I Already Know

- PRD P0 明确要求：IP 开出后可直接复制；支持批量导出；续费、改密、切 IP 必须展示成功项、失败项和失败原因；切 IP 成功后弹出新代理信息。
- 当前 Customer 代理列表只支持单条复制，国家筛选没有真实选项，没有导出按钮，没有续费/改密/切 IP 操作。
- 后端已有 `GET /api/proxies/export`、`POST /api/proxies/:id/renew`、`change-password`、`switch-ip` 入口。
- 当前 `RenewProxyUseCase`、`ChangePasswordUseCase`、`SwitchIpUseCase` 都会在 provider active 后抛 `UNSUPPORTED_CAPABILITY`，不是可用实现。
- `ProviderAdapter` 目前只有库存、购买、查询订单；没有生命周期方法。
- `proxy_instances` 当前没有保存上游实例 ID，无法可靠向上游续费/改密/切 IP。
- `UpstreamApiAdapter` 已经能调用兼容 `/res_static/*` 的上游，最适合作为本任务第一条真实生命周期转发路径。

## Requirements

- 数据模型保存上游代理实例标识：
  - `proxy_instances` 增加 `upstreamProxyId` 可空字段。
  - `ProviderDelivery` / `ProxyDelivery` 扩展可选 `upstreamProxyId`。
  - Provider/上游返回代理列表时尽量映射该字段；UPSTREAM_API 读取上游 `proxy_id`。
- 后端生命周期能力：
  - `ProviderAdapter` 增加可选生命周期方法：续费、改密、切 IP。
  - `UpstreamApiAdapter` 实现 `/res_static/renew`、`/res_static/change_auth`、`/res_static/switch_ip` 转发。
  - Use case 校验用户、site、tenant、provider 状态和 `upstreamProxyId`；缺能力/缺上游实例 ID 必须返回明确错误，不假成功。
  - 切 IP 成功且上游返回新代理时，更新本层 `proxy_instances` 的 IP、端口、账号、密码、协议、到期时间，并返回新交付信息。
- Customer UI：
  - 代理列表支持按搜索关键字、国家、状态筛选。
  - 提供导出按钮，至少支持已有后端格式：`IP_PORT`、`IP_PORT_AUTH`、`AUTH_AT_IP_PORT`、`HTTP_URL`、`SOCKS5_URL`。
  - 单条代理保留复制格式弹窗。
  - 单条代理提供续费、改密、切 IP 操作；后端返回 `UNSUPPORTED_CAPABILITY` 或缺上游实例 ID 时显示明确失败原因。
  - 切 IP 成功后弹出新代理复制弹窗，并刷新列表。

## Acceptance Criteria

- [x] 新订单履约保存 `upstreamProxyId` 到 `proxy_instances`。
- [x] `UPSTREAM_API` 生命周期转发有单元测试覆盖请求路径、请求体和 envelope 错误映射。
- [x] Use case 测试覆盖无权限、缺上游实例 ID、provider 不支持、成功更新本地代理。
- [x] Customer 代理列表测试覆盖导出路径、生命周期按钮调用和 unsupported 错误展示。
- [x] API typecheck/lint/test/build 通过。
- [x] Web typecheck/lint/test/build 通过。

## Out of Scope

- 不在本任务完整实现 PR/IPIPD/985Proxy 原生生命周期 API，除非现有 adapter 已经有明确上游字段和低风险映射。
- 不做批量续费/批量改密/批量切 IP，只做单条操作和导出。
- 不做 Excel 导出，先使用后端已有文本格式。
- 不补动态住宅代理能力。

## Technical Approach

- Source of Truth：
  - 本层代理实例：`proxy_instances`。
  - 上游实例 ID：`proxy_instances.upstreamProxyId`，由 provider delivery 写入。
  - 交付密码：仍使用 `APP_ENCRYPTION_KEY` 加密存储，只有用户态 DTO 解密返回。
- Module boundaries：
  - Provider adapter 只负责上游 API 差异和响应映射。
  - Use case 负责权限、实例归属、能力判断、本地状态更新。
  - Controller 只做参数传递和 DTO 输出。
  - Customer UI 只编排 query/mutation 和可见反馈，不猜测 provider 能力。
- Error policy：
  - 缺上游实例 ID：`UPSTREAM_ERROR` 或 `UNSUPPORTED_CAPABILITY` + `upstream_proxy_id_missing`。
  - Adapter 未实现方法：`UNSUPPORTED_CAPABILITY` + `<action>_not_supported`。
  - 上游 envelope 非 0：沿用 `AppError` 明确展示 reasonKey。

## Technical Notes

- Relevant files:
  - `packages/db/prisma/schema.prisma`
  - `apps/api/src/modules/proxies/use-cases/*.ts`
  - `apps/api/src/modules/proxies/proxies.controller.ts`
  - `apps/api/src/modules/providers/provider.types.ts`
  - `apps/api/src/modules/providers/adapters/upstream-api.adapter.ts`
  - `apps/api/src/modules/fulfillment/use-cases/fulfill-static-proxy.use-case.ts`
  - `apps/web/src/features/customer-proxies/proxy-list.feature.tsx`
  - `apps/web/src/features/customer-proxies/proxy-copy-modal.tsx`
- Current risk: local integration DB has previously been behind Prisma schema (`tenants.brandConfig` missing); schema/migration work may require generated client refresh and typecheck instead of full integration DB run.

## Implementation Record

- DB: `proxy_instances` 增加可空 `upstreamProxyId` 字段和迁移；Prisma client 已重新生成。
- Provider contract: `ProxyDelivery` 扩展 `upstreamProxyId`；`ProviderAdapter` 扩展可选生命周期方法 `renewStaticProxy`、`changeProxyPassword`、`switchProxyIp`。
- Provider adapters: `UPSTREAM_API` 实现 `/res_static/renew`、`/res_static/change_auth`、`/res_static/switch_ip`；IPIPD、PR、985Proxy 在能识别的返回字段里尽量映射 `upstreamProxyId`。
- Backend lifecycle: 新增 `ProxyLifecycleService`，统一处理代理归属、上游实例 ID、provider 配置、能力判断和成功后本地交付字段更新；controller/use case 保持薄封装。
- Customer UI: 我的静态代理列表新增搜索、真实国家筛选、文本导出、续费 30 天、改密、切 IP；成功后弹出复制弹窗，失败时显示后端 `reasonKey`。
- Regression found and fixed: `UPSTREAM_API` HTTP 200 但 envelope code 为 `UNSUPPORTED_CAPABILITY` 时原本会折叠成 `UPSTREAM_ERROR`；已改为保留业务错误码。

## Verification

- `pnpm --filter @ipeasy/db generate`
- `pnpm --filter @ipeasy/db typecheck`
- `pnpm --filter @ipeasy/api typecheck`
- `pnpm --filter @ipeasy/api lint`
- `pnpm --filter @ipeasy/api test`
- `pnpm --filter @ipeasy/api build`
- `pnpm --filter @ipeasy/web typecheck`
- `pnpm --filter @ipeasy/web lint`
- `pnpm --filter @ipeasy/web test`
- `pnpm --filter @ipeasy/web build`
