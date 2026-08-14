# Research: IPIPD 设计系统 token 提取（用于全站对齐）

- 来源：`IPIPD-Permit/ipipd-clone/src/app/globals.css`（Tailwind v4 @theme + :root 变量，源站 671 个设计变量的移植）+ `ipipd_site/*/page.html`（真实页面 HTML 快照）。
- 我们的栈：React + Vite + **Ant Design**（非 Tailwind/shadcn）。策略：**把 token 映射到 antd ConfigProvider 主题 + 命名空间 CSS 变量**，不照搬 Tailwind 类。

## 颜色（light）

| 语义 | 值 | 映射到 antd / 用途 |
|---|---|---|
| primary | `#003afe` | ConfigProvider token.colorPrimary |
| primary gradient | `linear-gradient(180deg,#003afe,#002dcc)` | 认证页品牌区、CTA、hero |
| primary-foreground | `#ffffff` | 主按钮文字 |
| background | `#fafafc` | colorBgLayout（页面画布） |
| foreground | `#1f2329` | colorText（正文） |
| card | `#ffffff` | colorBgContainer |
| muted-foreground | `#45556c` | colorTextSecondary |
| accent | `#eef3ff` | 选中/hover 浅蓝底（菜单选中、tag） |
| accent-foreground | `#003afe` | 选中态文字 |
| destructive | `#ec003f` | colorError |
| border | `#d8d8d8` | colorBorder |
| input | `#d9d9d9` | colorBorder（输入框） |
| ring | `#003afe` | 聚焦环（colorPrimary 一致） |
| sidebar | `#ffffff` 底 / 选中 `#eef3ff` / 选中字 `#003afe` | 客户/管理侧栏 |

## 圆角 / 间距 / 字体

- radius：基准 `0.5rem`(8px)；按钮 `6px`、卡片 `8px`、认证面板 `12px`。→ antd token.borderRadius=8、borderRadiusLG=12；按钮单独 6。
- 字阶：xs .75 / sm .875 / base 1 / lg 1.125 / xl 1.25 / 2xl 1.5 / 3xl 1.875rem；正文 v2-body `0.9375rem`(15px)。行高 tight 1.25 / normal 1.5 / relaxed 1.625。
- 字体：`system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif`。
- section 纵向间距 `5rem`、hero content padding-top `4rem`。

## 断点（响应式）

globals.css 未显式列 @media（Tailwind 默认）。采用 Tailwind 标准断点对齐源站：
- sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536。
- 关键行为：≥lg 双栏（侧栏+内容 / 认证左右分栏）；<lg 折叠为单列 / 抽屉侧栏；内容最大宽 ~1200px 居中。

## 页面结构线索（来自 ipipd_site HTML 快照）

- dashboard 是「左固定侧栏 + 顶栏 + 内容卡片区」；侧栏分组（概览/静态代理/动态代理/钱包/账户/工具/公告/帮助）。
- 账户、充值、检测工具、优惠券、公告中心等都是独立页，卡片化、留白充足。
- 我们已有对应页（overview/buy/proxies/wallet/api-keys/proxy-check/tickets/account/notifications），本任务只调**视觉**对齐这套 token，不改数据/接口。

## 映射策略（落地方式）

1. **antd 主题**（providers.tsx ConfigProvider）：注入 colorPrimary/colorBgLayout/colorText/colorTextSecondary/colorBorder/borderRadius 等 = 上表。品牌 primaryColor 仍可覆盖（站点配置优先）。
2. **命名空间 CSS 变量**（如 `:root{--ipx-primary:#003afe;...}` 在一个全局样式文件）：供认证页/首页/布局的非 antd 结构用。
3. **认证页**：品牌区用 primary 渐变；面板圆角 12px。
4. **布局**：侧栏白底 + 选中 `#eef3ff`/`#003afe`；画布 `#fafafc`；内容限宽 1200 居中。
5. **响应式**：统一断点；<lg 侧栏转抽屉、双栏转单列、表格可横向滚动。

不照搬 Tailwind 类名；不引入 Tailwind；不破坏现有 antd 组件行为与数据逻辑。
