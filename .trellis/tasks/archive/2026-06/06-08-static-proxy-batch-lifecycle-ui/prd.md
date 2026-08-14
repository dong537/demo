# Task: 静态代理批量生命周期前端完善

## Goal

在 Customer「我的代理」页面补齐批量续费、批量改密、批量切 IP 体验，衔接已完成的后端批量生命周期接口，让用户可以选择多条静态代理后一次提交，并看到成功项、失败项、失败原因和可复制的新代理信息。

## What I Already Know

- 后端已新增 Customer 批量接口：
  - `POST /api/proxies/batch-renew`
  - `POST /api/proxies/batch-change-password`
  - `POST /api/proxies/batch-switch-ip`
- 后端批量响应为 `{ totalCount, successCount, failureCount, items }`。
- 成功 item 包含解密后的 Customer proxy delivery DTO；失败 item 包含 `{ code, reasonKey, httpStatus }`。
- 现有 `CustomerProxyListFeature` 已支持列表筛选、导出、单条续费/改密/切 IP，并在单条成功后打开 `ProxyCopyModal`。
- 现有前端请求层是 `shared/api/client.ts` 的 `userApiRequest`，不是 openapi-ts client。
- 现有测试位于 `apps/web/src/features/customer-proxies/tests/customer-proxy-flow.spec.tsx`。
- 当前 `.trellis/tasks/18-reseller-admin-ui/` 是未跟踪残留目录，本任务不触碰、不提交。

## Requirements

- 在 `CustomerProxyListFeature` 的表格中启用行选择，选中项来源于当前页真实 API 返回的 proxy id。
- toolbar 新增批量操作入口：
  - 批量续费 30 天
  - 批量改密
  - 批量切 IP
- 未选择任何代理时，批量按钮必须 disabled，并用 i18n 文案表达需要先选择代理。
- 批量续费请求体为 `{ proxyIds, durationDays: 30, idempotencyKey }`，`idempotencyKey` 在前端每次批量提交时生成一次。
- 批量改密和批量切 IP 请求体为 `{ proxyIds }`。
- 批量请求必须调用后端新接口，不能在前端循环调用单条接口。
- 批量成功后刷新 `customer-proxies` query。
- 批量结果必须展示：
  - 总数、成功数、失败数；
  - 成功项 proxy id / IP / 端口 / 账号；
  - 失败项 proxy id、`reasonKey`、`code`、`httpStatus`；
  - 若有成功项，允许打开/复用现有复制弹窗查看某个成功 proxy 的连接格式。
- 批量失败的全局请求错误（网络、鉴权、整体校验失败）仍走现有 `actionError` Alert，不伪装成 item 失败。
- 保留现有单条生命周期操作和导出行为。
- 文案补充到 `zh.ts` 和 `en.ts`，不在组件中硬编码用户可见文本。

## Acceptance Criteria

- [x] 批量按钮未选择时 disabled，选择至少一条 proxy 后可点击。
- [x] 批量续费调用 `/api/proxies/batch-renew`，body 包含选中 proxyIds、`durationDays: 30` 和请求级 `idempotencyKey`。
- [x] 批量改密调用 `/api/proxies/batch-change-password`，body 只包含选中 proxyIds。
- [x] 批量切 IP 调用 `/api/proxies/batch-switch-ip`，body 只包含选中 proxyIds。
- [x] 批量结果展示成功/失败计数和每项成功/失败详情。
- [x] 批量成功项可复用 `ProxyCopyModal` 查看连接格式。
- [x] 全局请求错误显示后端 reasonKey，不误报为空列表或成功。
- [x] 现有单条动作、导出、筛选行为保持不变。
- [x] Web typecheck/lint/test/build 通过。

## Technical Approach

- 在 `proxy-list.feature.tsx` 内新增批量 response/item 类型和 `buildProxyBatchLifecyclePath(action)` helper，和现有 `buildProxyLifecyclePath` 保持相邻。
- 使用 Ant Design Table rowSelection，通过 `ListPage` 传入 rowSelection；如果 `ListPage` 当前未透传，需要小范围扩展 shared UI 类型。
- 使用一个 batch mutation 处理三种动作，mutation input 为 `{ action, proxyIds }`。
- 批量结果展示优先用 Drawer 或 Modal，避免在页面上堆长 Alert；结果状态留在 client state。
- 成功项按钮调用 `setCopyProxy(item.proxy)` 复用现有复制弹窗。
- 测试以公共 UI 行为和 API path/body 为主，不测实现细节。

## Decision (ADR-lite)

**Context**: 后端批量接口已经把逐项错误映射和审计边界收敛到 batch use case，前端若循环单条接口会绕过批量汇总契约，也会让失败结果和 loading 状态难以统一。

**Decision**: 前端批量操作只调用后端批量接口，并把批量响应作为页面级结果展示；单条操作继续保留。

**Consequences**: 用户可一次处理多条代理并看到完整结果；后续如果后端改为异步批量任务，前端只需要替换 batch mutation 和结果展示，不影响单条动作。

## Out of Scope

- 不新增 Admin 批量生命周期页面。
- 不修改后端批量接口和生命周期 use case。
- 不做异步进度、队列状态或轮询。
- 不做批量备注编辑、批量下载 Excel 或新导出格式。
- 不处理跨页选择；本任务只支持当前页选择。
- 不触碰 `.trellis/tasks/18-reseller-admin-ui/` 未跟踪目录。

## Technical Notes

- Relevant files:
  - `apps/web/src/features/customer-proxies/proxy-list.feature.tsx`
  - `apps/web/src/features/customer-proxies/proxy-copy-modal.tsx`
  - `apps/web/src/features/customer-proxies/tests/customer-proxy-flow.spec.tsx`
  - `apps/web/src/shared/ui/list-page.tsx`
  - `apps/web/src/shared/i18n/zh.ts`
  - `apps/web/src/shared/i18n/en.ts`
- Relevant backend contract:
  - `.trellis/spec/backend/database-guidelines.md` scenario `Static Proxy Lifecycle Source Of Truth`
  - `.trellis/spec/backend/logging-guidelines.md` scenario `Static Proxy Audit Logs`
- Relevant frontend spec to read before implementation:
  - `.trellis/spec/frontend/state-management.md`
  - `.trellis/spec/frontend-ui-ux.md`
  - `.trellis/spec/guides/cross-layer-thinking-guide.md`

## Implementation Record

- `CustomerProxyListFeature` 新增当前页 row selection、三种批量生命周期按钮和批量结果 Drawer。
- 批量续费/改密/切 IP 只调用后端批量接口，不在前端循环单条生命周期接口。
- 批量成功后清空选择、刷新 `customer-proxies` query，并展示成功/失败汇总。
- 成功 item 可复用 `ProxyCopyModal` 查看连接格式；失败 item 展示 `reasonKey/code/httpStatus`。
- `ListPage` 小范围支持 Ant Design `rowSelection` 透传。
- 补充 `zh.ts` / `en.ts` 批量操作和结果文案。
- 扩展 `customer-proxy-flow.spec.tsx` 覆盖批量按钮状态、请求 body、结果展示和复制入口。
- 更新 `.trellis/spec/frontend/state-management.md` 记录 Customer 批量生命周期 UI 契约。

## Verification

- `pnpm --filter @ipeasy/web typecheck`
- `rtk pnpm --filter @ipeasy/web lint`
- `rtk pnpm --filter @ipeasy/web test`（8 files / 28 tests passed）
- `rtk pnpm --filter @ipeasy/web build`
- `rtk git diff --check`
