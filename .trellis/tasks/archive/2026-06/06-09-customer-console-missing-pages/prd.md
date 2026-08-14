# Task: 补齐客户控制台缺失页面（全栈，三功能）

## 背景与范围确认

用户初始诉求是"完善前端、不要多余功能"。经后端调研（见 `research/backend-customer-endpoints.md`）确认：
所选三个功能 **均无法只做前端**，必须先补后端，用户已明确确认接受全栈、三个都做。

三功能与推进顺序：
1. **API Key 管理**（最轻：后端补列表端点 + 前端页）
2. **反馈 / 工单**（新建后端模块 + DB 迁移 + 前端页）
3. **代理验证工具**（新建后端检测能力 + 前端页）

### 明确不做（避免多余功能）
- API Key：不做权限范围 UI 编辑器、不做 IP 白名单可视化编辑器（仅按现有 DTO 字段透传）、不做调用日志/限流页。
- 工单：不做附件上传、不做工单分类/优先级体系、不做 SLA、不做邮件通知。仅 建单 / 我的工单列表 / 详情含消息时间线 / 回复 / 关闭。
- 验证工具：不做批量验证、不做定时探测、不做地理位置/延迟图表。仅单条代理连通性检测。
- 优惠券、实名/风控、推广邀请：本任务不做（无后端，且不在所选三项内）。

## 工程约束（来自全局协议 + PRD + 项目 spec）

- **禁止假 UI**：每个页面必须连真实后端端点，无 fallback、无 mock、无假数据。
- **租户隔离**：所有新数据对象带 `siteId` + `tenantId`，查询默认带租户边界（PRD 3.3）。
- **Source of truth 在后端**：前端只提交意图 + 失效重读；不乐观改写。
- **审计**：高危/写操作写 `audit_logs`（API Key 签发/吊销已有；工单操作、验证操作按需）。
- **统一契约**：响应走 `{code,msg,data,requestId}` 信封；错误抛 `AppError(ErrorCode, reasonKey, httpStatus)`。
- **前端约定**（`.trellis/spec/frontend/`）：thin route + `*.feature.tsx`；customer 用 `userApiRequest`；TanStack Query；文案走 i18n `t(key)`；loading/empty/error/permission 状态齐全。
- **契约再生成**：后端路由/DTO 变更后必须跑 `pnpm --filter @ipeasy/api export:openapi` → `pnpm --filter @ipeasy/contracts generate` → `typecheck`。

## 功能 1：API Key 管理（最轻，先做）

### 后端缺口
现有：`POST /api/api-keys`（签发，返回一次性 `plainKey`）、`DELETE /api/api-keys/:id`（吊销）。
缺：**列表端点**。没有列表，客户进页面看不到自己已有的 key，做不出页面。

### 后端要补
- `GET /api/api-keys`（`@RequireAuth`，use-case 内放行 `USER` / `TENANT_ADMIN`）
  - 按 `ctx.ownerId + ctx.siteId + ctx.tenantId` 过滤，返回当前身份自己的 key 列表。
  - 响应每项：`{ id, keyPrefix, scopes, ipWhitelist, status, createdAt, lastUsedAt, revokedAt }`——**绝不返回 `keyHash` 或明文**。
  - 分页用项目 `PageResult<T>` 约定（page/pageSize），repository 边界 `Number()` 强转。
  - 新增 `ApiKeysRepository.listForOwner(...)`。
- 吊销 use-case 写 `audit_logs`（`action: 'api_key.revoke'`），与现有 create 审计对齐（现状 revoke 是否已写审计需核，缺则补）。
- DELETE 的越权防护：只能吊销自己 `ownerId` 名下的 key（核现状，缺则补归属校验）。

### 前端
- 路由：`apps/web/src/routes/customer/api-keys/index.tsx`（thin）→ feature `features/customer-api-keys/api-key-list.feature.tsx`。
- 客户布局菜单加「API Key」入口（`routes/customer/_layout.tsx`）。
- 页面：`ListPage` 列表（keyPrefix、scopes、status、createdAt、lastUsedAt、操作=吊销）+ toolbar「创建」。
- 创建：Modal/Drawer 表单（name 可选、scopes 多选、ipWhitelist 可选）。`tenantId` 由 `useCurrentCustomer().data.tenantId` 注入，不让用户手填。
- 创建成功：弹出一次性 `plainKey`，复用/参照 `proxy-copy-modal` 的复制体验，明确提示"只显示一次"。
- 吊销：`Popconfirm` 危险确认 → DELETE → 失效 `['api-keys']`。
- 状态：loading/empty/error/permission 全走 `ListPage`；错误显示后端 `reasonKey`。
- i18n：键加到 `shared/i18n/{zh,en}.ts`。

## 功能 2：反馈 / 工单（新建后端模块）

### 后端（全新模块 `apps/api/src/modules/tickets/`）
- DB（Prisma schema + 迁移）：
  - `tickets`：`id, siteId, tenantId, userId, subject, status(OPEN|PENDING|CLOSED), createdAt, updatedAt`。
  - `ticket_messages`：`id, ticketId, siteId, tenantId, authorType(USER|ADMIN_USER), authorId, body, createdAt`。
  - 均带 `siteId + tenantId`，关系 + 索引按现有 model 风格。
- 端点（`@RequireAuth`，customer 面，按 ownerType 分流）：
  - `POST /api/tickets` body `{ subject, body }` → 建单 + 首条消息（一个事务）。
  - `GET /api/tickets` → 我的工单分页列表（按 `ctx.ownerId/siteId/tenantId`）。
  - `GET /api/tickets/:id` → 工单详情 + 消息时间线（归属校验，越权返回 `NOT_FOUND / ticket_not_found`）。
  - `POST /api/tickets/:id/messages` body `{ body }` → 追加回复（归属校验）。
  - `POST /api/tickets/:id/close` → 关闭（归属校验）。
- 写操作写 `audit_logs`（`ticket.create` / `ticket.reply` / `ticket.close`）。
- 校验：空 subject/body → `VALIDATION_ERROR`；非自己工单 → `NOT_FOUND`（不泄露存在性）。
- 契约再生成。

### 前端
- 路由：`routes/customer/tickets/index.tsx`（列表）、`routes/customer/tickets/$ticketId.tsx`（详情）。
- feature：`features/customer-tickets/ticket-list.feature.tsx`、`ticket-detail.feature.tsx`。
- 列表：`ListPage`（subject、status、updatedAt、操作=查看）+ toolbar「新建工单」。
- 详情：summary + 消息时间线（antd `Timeline`/`List`）+ 回复框 + 关闭按钮（危险确认）。
- 状态全齐、文案 i18n。

## 功能 3：代理验证工具（新建后端检测能力，最后做）

### 后端（新端点，归入 proxies 或新建 proxy-check）
- `POST /api/proxy-check` body `{ proxyId }` 或 `{ host, port, protocol, username?, password? }`（二选一，优先 `proxyId`：传自己名下代理 id，后端取真实连接信息，避免客户端拼装）。
  - `@RequireAuth`，`proxyId` 必须归属当前用户（越权 `NOT_FOUND`）。
  - 后端发起一次受控出站探测（HTTP CONNECT / SOCKS5 握手 + 一个固定探测目标），带超时。
  - 响应：`{ reachable: boolean, latencyMs?: number, exitIp?: string, error?: { code, reasonKey } }`。
  - **SSRF 防护**：仅允许探测自己名下代理的真实出口；若走 host/port 模式，必须校验/限制目标，禁止内网地址。
  - 写 `audit_logs`（`proxy.check`）。
- 该功能涉及对外网络探测，是新能力，实现前需在 research 里确认探测库选型（成熟库，不自造）与超时/并发/SSRF 边界；选型先 spike。

### 前端
- 路由：`routes/customer/proxy-check/index.tsx` → `features/customer-proxy-check/proxy-check.feature.tsx`。
- 也可在「我的静态代理」行操作加「检测」入口复用同端点（按需，先做独立页）。
- 结果展示：reachable/latency/exitIp 或失败 reasonKey；状态全齐、文案 i18n。

## 验收（对照 PRD 15）
- 三页均连真实后端，无假数据/假按钮/假链接。
- loading / empty / error / permission 状态清楚。
- 危险操作（吊销 key、关闭工单）有确认。
- 一次性 `plainKey` 提示只显示一次并可复制。
- 租户隔离：列表/详情/写操作默认带租户边界，越权不可见。
- 后端契约变更后 openapi.json / generated 已重新生成且 typecheck 通过。
- 每个后端 use-case 有单元 + 集成测试；每个前端 feature 有组件测试（验证调真实端点、错误显示 reasonKey、危险操作需确认）。

## 实施顺序与里程碑
1. **里程碑 1（API Key）**：后端 GET 列表 + 归属/审计补全 → 契约再生成 → 前端页 → 测试 → 验证。
2. **里程碑 2（工单）**：Prisma model + 迁移 → 模块/端点/审计 → 契约 → 前端列表+详情 → 测试。
3. **里程碑 3（验证工具）**：探测选型 spike（写 research）→ 后端端点 + SSRF 防护 → 契约 → 前端页 → 测试。

每个里程碑独立可验证、独立提交。里程碑之间回到主 session 汇报后再继续下一个。
