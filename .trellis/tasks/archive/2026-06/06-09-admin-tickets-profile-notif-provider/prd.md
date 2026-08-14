# Task: 工单工作台 / 用户资料改密 / 通知 / Provider 健康与请求日志（全栈，5 里程碑）

## 背景与范围

经后端调研（research/backend-gaps.md）确认 4 个候选功能均无法纯前端做，全部要先补后端。
用户确认全做，并定了两个关键设计决策：
- **站内通知只由「工单回复」产生**（admin 回复客户工单 → 给该客户产生一条通知）。范围最小、与工单工作台联动。
- **用户自助资料做到「改密 + 可编辑资料字段」**：users 表需加可编辑字段（name/phone）+ 迁移。

注意：用户提到的「给用户充值改余额、设置某用户价格、配置全局价格」**已在前序任务完成**（钱包调账、用户价格覆盖、全局价格模板），本任务不重复做。

## 依赖与里程碑顺序

通知产生源 = 工单 admin 回复，故工单工作台必须先于通知。排序：
1. **请求日志读端点 + admin 页**（最轻、独立，热身）
2. **管理员工单工作台**（admin 工单读写 + 状态流转）
3. **消息通知**（新表+模块；通知写入点挂在里程碑 2 的 admin 回复 use-case）
4. **用户自助资料 + 改密**（users 加字段+迁移；/users/me + 改密）
5. **Provider 健康**（providers 从零建对外 controller）

每里程碑：后端 → 契约再生成 → 前端 → 测试 → 复审 → 提交。逐个回主 session 汇报。

## 通用工程约束（全局协议 + 项目 spec）
- 真实后端、无假数据/假按钮；错误抛 AppError(ErrorCode, reasonKey, httpStatus)；前端显示 reasonKey。
- 租户隔离：所有数据带 siteId+tenantId；TENANT_ADMIN 限本租户、PLATFORM_ADMIN 限本 site；越权 NOT_FOUND 不泄露存在性。
- 审计：写操作落 audit_logs（字段风格对齐 api-keys/tickets 现有 use-case）。
- 前端（.trellis/spec/frontend/）：thin route + *.feature.tsx；admin 用 apiRequest，customer 用 userApiRequest；TanStack Query；antd；i18n（zh+en 同步）；loading/empty/error/permission 全齐；不乐观改写。
- 后端契约变更后跑：export:openapi → contracts generate → typecheck。
- 角色按钮防假 UI：后端不放行的角色不给入口（见 .trellis/spec/frontend/quality-guidelines.md）。

<!-- MILESTONES -->

## 里程碑 1：上游请求日志（读端点 + admin 页）

后端现状：`upstream_request_logs` 表存在、写入已脱敏（`redactSensitiveSummary`），但 `UpstreamLogRepository` 只有 create，无查询；无 controller 读。
后端要补：
- `UpstreamLogRepository` 加查询方法：按 siteId/tenantId + providerCode + status + 时间范围分页（PageQueryDto，边界 Number() 强转）。
- admin 读端点 `GET /api/upstream-request-logs`（@RequireAuth，use-case 内仅 admin；TENANT_ADMIN 限本租户/PLATFORM_ADMIN 限 site）。响应已脱敏字段（requestSummary/responseSummary 已 redact，直接返回）。
- 契约再生成。
前端：admin 路由 + 菜单（platform/tenant 按可见性）；列表页（providerCode/status/时间范围筛选）+ 详情查看脱敏摘要。仅 admin。

## 里程碑 2：管理员工单工作台

后端现状：tickets/ticket_messages 表全，`ADMIN_USER` 枚举已在；但接口全是 USER-only（requireTicketOwner 硬卡 USER + ownerId 收窄），仓库回复硬编码 authorType='USER'，无租户范围查询。
后端要补（不新表）：
- admin 工单端点（新 controller 段或 tickets 模块加 admin 路由）：
  - `GET /api/admin/tickets`（或合适路径）：admin 列表，PLATFORM=全 site / TENANT=本 tenant 范围，分页+状态筛选。
  - `GET /api/admin/tickets/:id`：详情+消息时间线，租户范围归属校验（非本租户 NOT_FOUND）。
  - `POST /api/admin/tickets/:id/messages`：admin 回复，新增 `appendAdminMessage`（authorType='ADMIN_USER'，authorId=ctx.ownerId），审计 actorType='ADMIN_USER' action='ticket.admin_reply'。
  - `POST /api/admin/tickets/:id/status`：状态流转（OPEN/PENDING/CLOSED），审计。
- 仓库加租户范围查询方法（不带 ownerId 过滤，带 siteId/tenantId）。
- 不破坏现有 USER-only 客户端点。契约再生成。
前端：admin 路由 + 菜单（platform+tenant 都可见）；工单列表（状态筛选）+ 详情（时间线区分 USER/ADMIN_USER 消息 + admin 回复框 + 状态流转按钮）。
**为里程碑 3 预留**：admin 回复 use-case 是通知产生点（里程碑 3 在此挂通知写入）。

## 里程碑 3：消息通知（站内信，仅工单回复产生）

后端（新模块 + 新表 + 迁移）：
- 新表 `notifications`：id, siteId, tenantId, userId, type, title, body, relatedType?(ticket), relatedId?(ticketId), readAt?, createdAt。索引 [siteId,tenantId,userId,readAt]。迁移。
- 新模块 notifications（controller/use-case/repository），customer 面（@RequireAuth 内放行 USER，按 userId+site+tenant 隔离）：
  - `GET /api/notifications`（分页列表）
  - `GET /api/notifications/unread-count`（未读数）
  - `POST /api/notifications/:id/read`（标记已读，归属校验）
  - `POST /api/notifications/read-all`（全标已读）
- **通知产生点**：在里程碑 2 的 admin 回复 use-case（appendAdminMessage 之后、同事务或紧随）写一条 notification 给工单所属 userId（type='ticket_reply', relatedType='ticket', relatedId=ticketId, title/body 取工单 subject）。这是唯一产生源，不做空收件箱。
- 契约再生成。
前端（customer）：布局顶部加未读通知入口（铃铛 + 未读数 badge，轮询或进入时拉 unread-count）；通知列表页/抽屉（列表 + 标记已读 + 全部已读 + 点击跳对应工单详情）。i18n。

## 里程碑 4：用户自助资料 + 改密

后端：
- users 表加可编辑字段（name?, phone?）+ 迁移。
- `GET /api/users/me`（@RequireAuth 内放行 USER）：返回当前用户真实资料（email/name/phone/status/kycStatus/riskStatus，不返回 passwordHash）。
- `PUT /api/users/me`（USER）：编辑 name/phone（email 改动若做需处理 @unique 冲突；本里程碑可先只放开 name/phone，email 只读，避免唯一冲突复杂度——按实现判断，若放开 email 必须处理冲突返回 reasonKey）。
- `POST /api/auth/change-password`（USER）：body {oldPassword, newPassword}。**安全约束**：bcrypt.compare 校验旧密码，错误返回统一 AppError（不泄露）；新密码 bcrypt.hash（生产 cost ≥10）写回 passwordHash；改密后吊销其它 session（sessions.revokedAt）；审计 action='auth.change_password'。新密码强度基本校验（长度等）。
- 契约再生成。
前端（customer）：布局加「账户/资料」入口；资料页（查看 + 编辑 name/phone 表单）+ 改密表单（旧密码/新密码/确认新密码，前端基本校验）。改密成功提示 + 错误 reasonKey。i18n。

## 里程碑 5：Provider 健康（admin）

后端现状：providers 模块无对外 controller（仅内部领域服务 ProviderRegistryService 等），provider_accounts 表存在，adapter 有 healthCheck 能力。注意别与 upstream-accounts 的 /test（上游 API 账号）混淆——这是 Provider（provider_accounts）。
后端要补（不新表）：
- providers admin controller（从零）：
  - `GET /api/providers`（admin）：Provider 账号列表（provider_accounts，凭据不回显，含 status/baseUrl/能力概要）。
  - `POST /api/providers/:id/health-check`（admin）：调 registry/adapter healthCheck 做连通测试，返回结果（reachable/latency/能力）。健康结果是否落表本里程碑不做（即时探测即可）。
- 契约再生成。
前端（admin，仅 PLATFORM_ADMIN，按调研 provider 是平台级）：Provider 健康页（列表 + 连通测试按钮 + 结果展示）。凭据不回显。i18n。

## 验收（每里程碑）
- 连真实接口、无假数据/假按钮；loading/empty/error/permission 全齐；错误 reasonKey；文案 i18n（zh+en）。
- 租户隔离 + 越权 NOT_FOUND；写操作审计；危险操作确认。
- 改密：校验旧密码、bcrypt 合理 cost、改密吊销其它 session、不泄露账户存在性。
- 通知：只由工单回复产生，无空收件箱假数据。
- 后端契约变更后 openapi/generated 重新生成且 typecheck 通过。
- 每里程碑后端单元+集成测试、前端组件测试；独立提交。迁移因无本机 DB 无法应用时明确标注（不伪造）。
- 实现中发现与 prd 假设不符（字段/权限），停下报告，不造假 UI、不擅自扩范围。
