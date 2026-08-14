# Task: 自助注册 + 用户端简约大气改版（全栈，3 里程碑）

## 背景与决策

用户在生产登录页反馈：无注册功能、用户页面太素。已确认：
- **① 开放自助注册**（补后端注册端点 + 前端注册页）
- **② 美化范围 = 认证页 + 整个客户控制台**，风格「简约大气」（管理端不动）

约束：真实后端、无假数据；不降低安全（注册要查重、哈希、租户隔离）；i18n（zh+en）；前端遵循 .trellis/spec/frontend。

## 里程碑 1：后端自助注册端点

现状：auth 模块只有 login/me/logout/change-password；无注册；users 无自助创建。login 模式 = 前端先 `GET /api/sites/current` 拿 siteId，再带 siteId 调登录。

要做：
- `POST /api/auth/register`（public，无鉴权），body `{ email, password, siteId }`：
  - email 校验 + 唯一性（同 siteId 下 email 已存在 → `VALIDATION_ERROR/email_taken`，不泄露其它信息）。
  - password 强度校验（最小长度 8，复用改密的 MIN_PASSWORD_LENGTH 常量 / `password_too_weak`）。
  - **租户归属**：开放注册归到该 site 的默认 signup 租户。先核实如何确定默认租户（建议：取该 site 下最早创建的 ACTIVE 租户，或约定 code='DEFAULT'；按真实数据/现有约定决定，写清选择）。若 site 无可用租户 → 明确错误，不静默。
  - bcrypt.hash（cost ≥10）创建 user（status=ACTIVE, kycStatus=NONE, riskStatus=NORMAL）+ 同事务建 wallet（available=0, currency=平台币种）。参照 seed-customer.ts 的 user+wallet 结构。
  - 审计 action='auth.register'。
  - 注册成功返回什么：建议直接不返回 token（让用户去登录），或复用 login 逻辑返回 token 自动登录——二选一，说明选择（倾向返回 token 自动登录，体验顺）。
- 契约再生成：export:openapi → contracts generate → typecheck。

测试：后端单元——email 查重拒绝、弱密码拒绝、成功建 user+wallet+审计、租户归属正确；集成（无 DB 说明未跑）。

## 里程碑 2：前端注册页 + 认证页简约大气改版

- 新增客户注册页 `/register`（feature `features/auth/customer-register.feature.tsx`）：email/password/确认密码，前端校验（邮箱格式、密码≥8、两次一致）；`GET /api/sites/current` 拿 siteId → `POST /api/auth/register`；成功后（按里程碑1的返回）自动登录跳 /overview 或跳登录页；错误显示后端 reasonKey（email_taken/password_too_weak）。
- router 注册 `/register`（public，仿 customerLoginRoute）。
- 客户登录页加「没有账号？去注册」链接；注册页加「已有账号？去登录」。
- **认证页简约大气改版**（customer-login、customer-register、admin-login）：
  - 不再是居中一个裸 antd Card。改成有质感的认证布局：左侧品牌区（IPEasy 品牌名/标语/简洁视觉，可用渐变或纯色块但克制）+ 右侧表单卡片；移动端单列。
  - 用站点品牌（`/api/sites/current` 的 brandConfig name/primaryColor）渲染品牌名与主色，不硬编码。
  - 间距/字号/层次精致；保留现有表单逻辑与校验不破坏；文案 i18n。
  - 样式限定在认证页命名空间，不污染 antd 后台页。

测试：注册组件——校验阻止提交、提交 body 正确、email_taken 错误显示、成功跳转；登录页加链接后原有测试不破坏。

## 里程碑 3：客户控制台简约大气改版

- 对象：客户布局 `routes/customer/_layout.tsx` + 各客户页面的外观（overview/buy/proxies/wallet/topup/api-keys/proxy-check/tickets/account/notifications）。
- 做「简约大气」：统一的客户侧布局（克制的顶栏/侧栏、留白、卡片化、主色取自品牌、状态标签、一致的页头）；overview dashboard 视觉再精致化。
- **只改外观与编排，不改数据逻辑/接口调用/校验**。保持所有 feature 的 server state、mutation、错误处理不变。
- 管理端（admin 布局与页面）**不动**。
- 文案 i18n；移动端可用；不堆装饰/营销 hero（克制的「简约大气」，非花哨）。
- loading/empty/error/permission 状态保持齐全。

测试：现有客户端组件测试全部仍通过（改外观不应破坏行为）；按需补少量。

## 验收（每里程碑）
- 真实后端、无假数据；错误 reasonKey；i18n zh+en；loading/empty/error/permission 齐全。
- 注册：查重、强密码、bcrypt、租户隔离、审计、wallet 同事务。
- 美化不破坏任何现有数据逻辑与测试。
- 每里程碑：相关 lint+typecheck+测试通过；契约变更后重新生成；独立提交。
- 迁移无（本任务不新表，user/wallet 表已存在）。

## 顺序
里程碑 1（注册后端）→ 2（注册页 + 认证页美化）→ 3（客户控制台美化）。逐个 implement→check→验证→提交→回主 session。
