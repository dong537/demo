# Task: 前端功能全量补齐（4 里程碑，均基于已就绪后端）

## 背景与范围

经后端接口穷举（research/backend-api-inventory.md）+ 前端覆盖盘点（research/frontend-coverage.md）确认：
平台大部分功能已闭环。本任务只补「后端已就绪、前端缺/缺全」的部分，**严禁为无后端的功能造假 UI**。

用户已确认做全部 4 项（覆盖 6 个能做的功能）。

### 设计指令（用户明确）
- **用户端：高端大气**。概览做成有视觉层次的聚合 dashboard，不是裸表格。
- **管理端：简洁克制，不堆多余功能**。只补全已有后端能力，不发明 PRD 之外的功能、不做装饰性 hero/渐变。

### 明确不做（无后端，做了就是假 UI）
优惠券、实名/风控状态、推广/邀请、管理员工单工作台（后端无 admin 侧工单接口）、用户自助资料/改密、消息通知、Provider 健康/Dry-run/请求日志、API 调用日志/限流/系统健康/对账/返佣。这些需先补后端，不在本任务。

## 工程约束（全局协议 + 项目 spec）
- 真实后端、无假数据/假按钮；错误显示后端 reasonKey；不乐观改写，mutation 成功失效 query。
- 前端约定（.trellis/spec/frontend/）：thin route + *.feature.tsx；admin 用 apiRequest，customer 用 userApiRequest；TanStack Query；antd；文案走 i18n（zh+en 同步）；loading/empty/error/permission 全齐。
- 权限：admin 路由 beforeLoad 用 requireAdminRole；后端 @RequireAuth + use-case 内按 ownerType 分流，角色不符返回 403（不是 401），前端按 ListPage 的 permission 分支处理。
- 不动后端、不动契约（本任务全部用现有端点；若发现确需后端改动，停下来报告，不擅自扩后端）。

<!-- MILESTONES -->

## 里程碑 1：客户概览高端 dashboard（用户端，先做）

现状：`/overview` 只显示余额（`customer-wallet-overview.feature`，调 `GET /api/wallet/:userId`）。
目标：聚合成高端 dashboard，全部连真实接口，无假数据。

聚合数据源（全部已就绪 customer 接口）：
- 余额卡：`GET /api/wallet/:userId`（available/frozen/currency）。
- 代理统计 + 即将过期：`GET /api/proxies`（按 status 统计总数/正常/即将过期；即将过期取 expiresAt 近 N 天）。
- 近期订单：`GET /api/orders`（取最近若干条 + 状态）。
- API Key 状态：`GET /api/api-keys`（数量 + 是否有 active）。

UI：
- KPI 卡片行（余额、代理总数、即将过期、API Key 数）+ 近期订单列表 + 即将过期代理列表 + 快捷入口（去购买/去充值/管理 Key）。
- 高端但克制：用 antd Card/Statistic/Tag/List，视觉有层次，不堆装饰。
- 每个区块独立 loading/error；某个查询失败不拖垮整页（各自 ListPage/Skeleton/Alert，显示 reasonKey）。
- 动态住宅能力：PRD 要求显示状态。后端无动态能力接口 → 显示明确「动态住宅暂缓接入」静态文案（这是 PRD §2.2 明确要求的真实状态，不是假数据）。
- 文案全 i18n。
- 入口已有（菜单 overview），无需改路由。

## 里程碑 2：管理端价格中心高级（管理端，价值最高）

现状：`/admin/pricing`（`price-template.feature`）只有模板列表 + 规则创建。
后端已就绪但前端没用的接口：
- `POST /api/pricing/overrides`（资源级价格覆盖）
- `POST /api/pricing/user-overrides`（用户级覆盖）
- `POST /api/pricing/user-template-bindings`（绑定用户模板）
- `POST /api/pricing/quote-sandbox`（管理员报价试算）

目标（克制，只补这 4 个已就绪能力，PRD §13.3 内）：
- 价格中心按域分 Tab/Section（模板 | 资源覆盖价 | 用户覆盖/绑定 | 报价沙盒），不做超长页。
- 资源覆盖价：表单（选资源 + 价格条件）→ POST overrides。
- 用户覆盖/绑定：表单（tenantId+userId + override 或 templateId）→ 对应 POST。
- 报价沙盒：输入 user/resource/duration/quantity/currency → POST quote-sandbox → 展示试算结果。
- 仅 PLATFORM_ADMIN（沿用现有 requireAdminRole）；表单校验 + 错误 reasonKey；成功失效相关 query；文案 i18n。
- 不做优惠券/折扣窗口/价格审计（无后端）。

## 里程碑 3：管理端钱包调账 + Admin APIKey UI（管理端）

### 3a 钱包人工调账
- 后端 `POST /api/wallet/:userId/adjust` body `{amount, currency, reason}`（admin only）已就绪。
- 现状 `/admin/wallet` 只读账本（`ledger-list.feature`）。
- 补：在 admin 钱包/用户详情处加「调账」入口（Drawer/Modal 表单：amount、currency、reason 必填），调 adjust → 成功失效 ledger query。
- 危险操作：reason 必填、提交确认；错误 reasonKey；审计后端已做。

### 3b Admin 侧 APIKey 管理
- 后端 `GET/POST/DELETE /api/api-keys`（放行 USER/TENANT_ADMIN；DELETE 也允许 PLATFORM_ADMIN）。
- 复用里程碑 1 已做的 customer-api-keys 模式，但 admin 用 apiRequest，tenantId 来自 useCurrentAdmin。
- 新增 admin 路由 + 菜单项；列表/创建（一次性 plainKey）/吊销。

## 里程碑 4：管理端代理运维 + 租户上游账号（管理端）

### 4a 代理详情 / 生命周期 / IP 续费搜索（admin）
- 现状 `/admin/proxies` 只读列表（`GET /api/proxies` 分页/status）。
- 后端 proxies 列表 admin 已支持更多过滤（tenantId/userId/orderId/countryCode/search/from/to，见 database spec 的 proxy search 场景）。
- 补：admin 代理列表增加筛选（IP/订单/客户/国家/状态/到期范围搜索）= PRD §13.4 的 IP 续费搜索；代理详情查看。
- 注意：续费/改密/切 IP 的后端是 USER only（@RequireUser/use-case USER），admin 不能直接调 → admin 侧只做查看 + 搜索定位，不放假的 admin 生命周期按钮（避免假 UI）。这点要在实现中核实 use-case 权限后决定按钮是否出现。

### 4b 租户上游账号（provider-accounts）管理
- 后端已就绪：`GET/POST/PUT/DELETE /api/tenants/:tenantId/provider-accounts`（admin only，凭据加密）。
- 现状无专页。
- 补：在租户详情（tenant-detail）加「上游账号」Tab 或独立页：列表 + 创建（providerCode IPIPD/985/PR + baseUrl + credential + 选项）+ 编辑 + 禁用。
- 凭据只填不回显；错误 reasonKey；仅 admin。

## 验收（每里程碑）
- 连真实接口、无假数据/假按钮；loading/empty/error/permission 全齐；错误显示 reasonKey；文案 i18n（zh+en）。
- 危险操作（调账/吊销）有确认。
- 不动后端、不动契约。
- 每里程碑：前端 lint + typecheck + 相关组件测试通过；独立提交。
- 实现中若发现某能力的后端权限/字段与预期不符（如 admin 不能调某端点），停下报告，不造假 UI。

## 实施顺序
里程碑 1（客户 dashboard，呼应"高端大气") → 2（价格中心，价值最高) → 3（钱包/APIKey) → 4（代理运维/上游账号)。
每个里程碑 implement → check → 验证 → 提交，逐个回主 session 汇报。
