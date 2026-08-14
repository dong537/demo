# 前端 UI/UX 规范

## 三个 Surface

- Public：官网、登录、注册、价格展示、帮助、API 文档入口。
- Customer：概览、购买静态住宅 IP、订单、代理、钱包、工单、教程、账户。
- Admin：概览、用户、租户/分站、供应商、资源库存、价格、订单履约、支付钱包、工单、审计日志、系统设置。

## 技术栈

推荐：

- React + Vite
- TanStack Router
- TanStack Query
- React Hook Form + Zod
- Ant Design
- OpenAPI 生成 API client/types

## 状态边界

- server state：TanStack Query。
- form state：React Hook Form + Zod。
- client state：仅放 UI 交互，例如 drawer open、tab、selected rows。
- mutation 成功后通过 query invalidation 或 optimistic update 更新。
- 禁止 API catch 后返回空数组冒充无数据。

## Admin UI

Admin 是高密度运营台，不套官网 hero 风格。

默认模板：

```txt
sidebar/topbar + toolbar + filters + table + drawer/modal + audit timeline
```

所有列表必须具备：

- loading
- empty
- error
- permission
- pagination
- filter/search

高危操作必须具备：

- 确认
- reason
- pending 状态
- 结果反馈
- audit log

## Customer UI

Customer 购买和钱包流程必须清楚反馈：

- loading
- quote
- 余额不足
- 库存不足
- 支付/充值状态
- 交付中
- 失败退款
- 成功复制/导出

第一阶段 Customer 只实现登录、余额、充值单、流水。代理购买和复制导出进入第二阶段。

Customer dashboard shell should follow `IPIPD-Permit/ipipd-clone/src/components/dashboard/*`:

- Desktop sidebar is fixed at 232px, white, with a `#d8d8d8` right border.
- Header is fixed at 56px, white, with a `#d8d8d8` bottom border; avoid blur, gradients, or decorative backgrounds.
- Sidebar balance uses the real wallet query and renders as a compact text block, not a marketing card.
- Navigation stays flat and dense with 8px radius, light-blue selected background, and primary text; avoid selected left bars or shadows.
- Customer content fills the main work area. Do not add a global centered max width such as `1320px`; page-level reading widths must be owned by the page itself.
- Every visible shell action must route to an existing real page; do not add fake actions to mimic the reference.

## Public UI

Public 可以参考 IPEasy 气质：

- 白底、大留白、浅灰分区、细边框卡片、8-12px 圆角。
- 主色 `#0040ff` / `#003afe`。
- 文字主色 `#101010`，正文灰 `#747689`，浅背景 `#f7f9fc`。

数据展示必须可信：

- 国家、地区、库存、延迟、可用率来自真实 Provider 库存或运营配置。
- 未接入能力必须显示真实暂缓状态，不能使用静态假数字。

## i18n 与可访问性

- 用户可见文案走 i18n locale。
- 后端返回稳定 `code/reasonKey`，前端负责本地化展示。
- 表单必须有 label、校验、错误提示。
- 控件必须支持 keyboard、focus、aria。
- 动画尊重 reduced motion。
