# Purchase line randomization and pricing simplification

## Goal

把静态代理购买和管理端相关选择面从“国家/地区/线路/网段”简化为“国家/地区 + 系统自动选择可用资源”。用户端不再让客户理解或选择网段编号；管理端代下单和用户专属定价也使用同一套更直白的国家/地区分组。

## Requirements

* 用户端购买页选择国家/地区后，系统自动选择当前地区里最适合购买的资源并报价，不再展示多个“网段 1 / 网段 2”卡片供客户选择。
* 用户端订单摘要仍展示国家、地区、售价、库存/实时确认状态和供应平台，不能丢失购买前必须知道的信息。
* 管理端代下单选择资源时，不再用“网段 1 / 网段 2”作为主要可见名称，卡片标题改为国家/地区，自动选择提示改成通俗文案。
* 管理端用户专属定价继续只按国家和具体地区批量设置价格，不要求运营逐个网段选择。
* 页面文案不能出现英文或“网段”这类让客户误解需要手动选择线路的字样；保留可复制资源编号作为内部追踪信息。
* 不改变后端价格、可售、库存 source of truth；仍由 `/api/resources`、`/api/resources/priceable-catalog`、`/api/pricing/quote` 和下单接口决定。

## Acceptance Criteria

* [ ] 用户端购买页不再渲染 `ipx-buy-network-card` 选择列表或“网段 1 / 网段 2”文案。
* [ ] 用户端切换国家/地区、搜索或分页时，自动选择当前可购买资源并刷新报价。
* [ ] 管理端代下单资源卡片和已选摘要不再显示“网段 1 / 网段 2”。
* [ ] 用户专属定价面板按国家和地区批量选择资源，不要求单独选择网段。
* [ ] 相关测试更新并通过，至少覆盖购买页和管理端代下单。

## Technical Approach

* 复用现有 `formatResourceLocationZh(...)` 作为展示标签 source of truth。
* 保留 `getPreferredResource(...)` 自动挑选逻辑，让系统优先选择有价格、有库存且地区更明确的资源。
* 删除用户端购买页的显式网络卡片层，改成一个自动选择状态面板。
* 管理端代下单卡片标题使用国家/地区，辅助信息显示“系统自动分配”。
* 共享标签从“自动推荐 / 网段 N”收敛为“系统自动分配 / 自动分配”。

## Out of Scope

* 不部署，除非用户单独要求。
* 不改后端定价/库存/下单规则。
* 不把不可售资源强行改成可售。
* 不重做整套资源管理 UI。

## Technical Notes

* 主要文件：
  * `apps/web/src/features/customer-proxies/buy-static-proxy.feature.tsx`
  * `apps/web/src/features/admin-users/admin-customer-order-drawer.feature.tsx`
  * `apps/web/src/features/admin-users/user-list.feature.tsx`
  * `apps/web/src/shared/resource/resource-selection-labels.ts`
  * `apps/web/src/features/customer-proxies/tests/customer-proxy-flow.spec.tsx`
  * `apps/web/src/features/admin-users/tests/admin-customer-order.spec.tsx`
* 前端规范要求用户可见文案走 i18n，数据请求使用 `apiRequest` / `userApiRequest`，不能伪造价格、库存或可售状态。
