# Task: 全站视觉对齐 IPIPD 设计系统 + 响应式（3 里程碑）

## 背景
用户要求全站 CSS/响应式参考其源码 IPIPD-Permit。设计 token 已提取到 research/ipipd-design-tokens.md。
源站是 Tailwind/shadcn，我们是 React+Vite+**Ant Design**——策略：token 映射到 antd ConfigProvider 主题 + 命名空间 CSS 变量，**不引入 Tailwind、不照搬类名**。

## 核心约束
- **只改视觉/响应式，绝不改数据逻辑/接口/查询键/校验/mutation/错误处理。** 改完所有现有测试必须仍通过。
- 站点品牌 primaryColor 仍优先（站点配置覆盖默认 token）。
- 全站 = 认证页 + 客户控制台 + 管理端 + 公开首页。
- i18n 不破坏；loading/empty/error/permission 状态保持。

## 里程碑 1：全局主题底座（antd token + CSS 变量）
- providers.tsx 的 ConfigProvider 扩展完整 token：colorPrimary `#003afe`(品牌覆盖优先)、colorBgLayout `#fafafc`、colorText `#1f2329`、colorTextSecondary `#45556c`、colorBorder `#d8d8d8`、borderRadius 8、borderRadiusLG 12、fontFamily（system 栈）、组件级（Button borderRadius 6、Menu 选中 `#eef3ff`/`#003afe`、Layout sider 白底）。
- 新增全局命名空间 CSS 变量文件 `apps/web/src/shared/theme/tokens.css`（`--ipx-*`：primary/gradient/bg/fg/accent/border/radius/字阶），main 入口 import。供认证页/首页/布局的非 antd 结构复用。
- 不动任何 feature 逻辑。验证：typecheck+lint+全量测试无回归；build 通过。

## 里程碑 2：认证页 + 公开首页对齐
- 认证页（auth.css）：品牌区用 `--ipx-primary` 渐变、面板圆角 12px、间距/字阶对齐 token。
- 公开首页（home.css 的 `.landing-*`）：配色/圆角/间距/断点对齐 token；响应式断点统一到 sm640/md768/lg1024/xl1280。
- 只调样式，不改 home.tsx/auth 表单逻辑。验证：auth + 首页相关测试通过；窄屏不破版。

## 里程碑 3：客户控制台 + 管理端布局响应式对齐
- 客户布局 + 管理布局 `_layout.tsx`：侧栏白底+选中 `#eef3ff`/`#003afe`、画布 `#fafafc`、内容限宽 1200 居中、统一页头；<lg 侧栏转抽屉、双栏转单列。
- 表格在窄屏可横向滚动（antd Table scroll.x，按需）。
- PageHeader / 卡片间距对齐 token。
- 管理端只调外观（保持克制信息密度），不改数据逻辑。
- 验证：全量测试无回归；客户/管理页窄屏可用。

## 验收（每里程碑）
- 真实样式、不引 Tailwind；token 来自 research；品牌覆盖生效。
- 不改数据逻辑/接口；现有测试全过；build 通过。
- 响应式断点统一；窄屏不破版。
- 每里程碑独立提交。无后端改动、无迁移、无契约变更。

## 顺序
1（主题底座）→ 2（认证+首页）→ 3（客户+管理布局）。逐个 implement→验证→提交→回主 session。
