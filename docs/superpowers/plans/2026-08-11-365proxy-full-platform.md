# 365Proxy 专线平台闭环实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标：** 将 365Proxy 从已有的专线库存、节点分配和 OpenUI 投影骨架，补成可收费、可交付、可运维、可上线验证的 SV/ZB 专线平台。

**架构：** PostgreSQL 是订单、钱包、价格、库存、节点分配和交付状态的唯一事实源；外部 985Proxy/ipipd、3x-ui/OpenUI、NY 转发面板通过 adapter 和可租约 external job 接入。页面只编排 server state，费用、库存、线路状态和权限由 API use case 决定。

**技术栈：** NestJS/Fastify、Prisma/PostgreSQL、Redis、React/Vite/Ant Design、TanStack Query、Vitest、Zeabur CLI。

## 全局约束

- 家宽和静态代理购买接口保持禁用；可售 SKU 仅走 dedicated-line contract。
- 客户不能提交 provider、节点、线路入口、复制数或加价规则；这些来自数据库策略和管理员配置。
- 专线下单必须先取得服务端价格快照，再在同一数据库事务中扣款、锁库存、写 external job。
- 生产路径不得用 mock、默认成功、空 catch 或未审计的 secret；上游失败必须保留可恢复状态。
- 生产 secret 只从 Zeabur 环境变量注入，不写入仓库；已公开的旧凭据在上线前轮换。

---

### Task 1: 专线订单资金闭环

**Files:**
- Modify: `apps/api/src/modules/dedicated-line-orders/domain.ts`
- Modify: `apps/api/src/modules/dedicated-line-orders/dedicated-line-inventory.repository.ts`
- Modify: `apps/api/src/modules/dedicated-line-orders/create-dedicated-line-order.use-case.ts`
- Modify: `apps/api/src/modules/dedicated-line-orders/dedicated-line-orders.module.ts`
- Test: `apps/api/src/modules/dedicated-line-orders/tests/dedicated-line-orders-api-integration.spec.ts`

**接口：** create use case 接收 `SkuQuoteUseCase` 和 `WalletRepository`，reservation input 携带 `totalPrice/currency`；库存、钱包和 external job 在一个 Prisma transaction 内完成，重复 idempotency key 返回同一 reservation，不重复扣款。

- [ ] 先写集成测试：有价格和余额时创建订单后 ledger 出现负向 `ORDER_DEBIT`；余额不足时无 reservation/job；重复请求只产生一条 ledger。
- [ ] 运行该测试确认在现状下失败，因为当前专线入口只锁库存不扣款。
- [ ] 在事务中校验订单价格和钱包币种，使用现有 `WalletRepository.debitWalletTx`，为专线订单生成稳定 ledger idempotency key。
- [ ] 运行专线 API 集成测试、钱包集成测试和 typecheck。

### Task 2: 客户专线购买和交付页面

**Files:**
- Create: `apps/web/src/features/dedicated-lines/dedicated-line-purchase.feature.tsx`
- Create: `apps/web/src/features/dedicated-lines/dedicated-line-list.feature.tsx`
- Create: `apps/web/src/features/dedicated-lines/dedicated-line-api.ts`
- Create: `apps/web/src/routes/customer/dedicated-lines/index.tsx`
- Modify: `apps/web/src/routes/customer/buy/index.tsx`
- Modify: `apps/web/src/routes/customer/_layout.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/shared/i18n/zh.ts`
- Test: `apps/web/src/features/dedicated-lines/tests/dedicated-line-purchase.spec.tsx`

**接口：** 使用 `/api/catalog/skus`、`/api/catalog/quote`、`/api/dedicated-line-orders`、`/api/dedicated-lines`；状态覆盖 loading/empty/error/queued/active/degraded/migrating/expired；只展示前门域名和线路客户端身份，不展示 SOCKS 出口凭证。

- [ ] 先写组件测试，断言 SV/ZB SKU、国家、数量、期限、报价、余额不足、库存不足和下单后跳转线路列表。
- [ ] 运行测试确认旧的静态代理购买页不满足断言。
- [ ] 实现专线购买表单和列表详情，保留充值、工单、API Key 等既有导航。
- [ ] 添加桌面/移动窄屏验证和 web typecheck/build/test。

### Task 3: 线路生命周期和运维动作

**Files:**
- Modify: `apps/api/src/modules/dedicated-lines/*`
- Create: `apps/api/src/modules/dedicated-lines/dedicated-line-lifecycle.use-case.ts`
- Modify: `apps/api/src/modules/dedicated-line-projections/*`
- Modify: `apps/worker/src/dedicated-line-projection-worker.ts`
- Test: `apps/api/src/modules/dedicated-lines/tests/dedicated-line-lifecycle-integration.spec.ts`

**接口：** 客户只能请求续期；管理员可以禁用、恢复、迁移和重新投影。所有动作生成新 desiredVersion、投影 job 和审计记录，线路只有投影和 NY 路由达到规则后才变为 ACTIVE/DEGRADED。

- [ ] 先写状态转换和续期集成测试，覆盖过期、禁用、投影失败和重复操作。
- [ ] 实现 server-owned transition guard、审计和 projection upsert/delete contract。
- [ ] 增加 worker 对超时、冲突、配置错误的租约恢复和 NEEDS_OPERATOR 状态。
- [ ] 运行 API/worker 相关测试和构建。

### Task 4: 库存、Socks5 健康与攻击防护

**Files:**
- Modify: `apps/api/src/modules/providers/*`
- Create: `apps/api/src/modules/dedicated-line-orders/dedicated-line-health.service.ts`
- Modify: `apps/worker/src/*`
- Modify: `apps/api/src/common/config/env.schema.ts`
- Test: provider/health/rate-limit integration tests

**接口：** 批量导入必须校验国家、SOCKS5、数量、过期时间和凭证；健康任务记录可审计观察值并将不可用库存从 saleable pool 排除；登录、下单、代理检查和 OpenAPI key 按 tenant/user/IP 做 Redis rate limit，拒绝异常 burst。

- [ ] 先写真实 adapter/domain 测试，再接 Redis-backed limiter；不把网络失败伪装为库存为空。
- [ ] 增加供应商国家覆盖与库存 freshness 的运营告警和 Bark outbox。
- [ ] 在部署前用受控测试出口验证 HK/US 等专线国家和 SOCKS5 连通性。

### Task 5: Zeabur 运行拓扑和线上烟测

**Files:**
- Create/Modify: `zeabur/*.yaml`, `Dockerfile`, `scripts/deploy-zeabur.mjs`, `README.md`, `.env.example`
- Modify: `CLAUDE.md`
- Test: `scripts/predeploy-check.mjs`, API/web/worker smoke scripts

**接口：** API、worker、web、Postgres、Redis 明确分离；迁移和 seed 是一次性 job，生产执行开关默认关闭，健康检查和日志可定位 requestId/external job/lineId。

- [ ] 读取现有 Zeabur 项目和服务，确认目标项目后才创建/更新服务。
- [ ] 为每个服务配置构建命令、启动命令、端口、健康检查和必要变量；不复制 secret 到文件。
- [ ] 部署后验证 `/health`、`/ready`、登录、SKU/quote、充值、下单、库存不足 Bark、投影回读、NY 多域名和客户交付。
- [ ] 记录真实 URL、service ID、命令、截图/响应和未完成风险。

### Task 6: 需求证据审计

**Files:**
- Modify: `.trellis/tasks/08-11-full-stack-audit-delivery/research/phase-6-order-projection.md`
- Modify: `README.md`, `PRD.md`, `EXECUTION_PLAN.md`

- [ ] 逐条映射用户需求到 API、数据库、worker、OpenUI、NY 路由、UI 和线上证据。
- [ ] 明确未完成项，尤其是 DNS/真实 3x-ui、付款通道、流量统计和运营权限，不用“已接入”替代实测。
- [ ] 跑 `pnpm` 质量门、`git diff --check` 和线上 smoke；保留 rotatable secret 提醒。
