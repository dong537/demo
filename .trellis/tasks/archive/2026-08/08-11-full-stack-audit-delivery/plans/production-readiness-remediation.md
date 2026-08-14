# 365Proxy 专线平台生产整改实施计划

> 按主会话 inline 执行；每个行为改动遵循 RED -> GREEN -> 回归验证。五月版前端源码保持只读。

**目标：** 消除当前生产审计阻断项，并用真实灰度链路证明平台可以接收和交付专线订单。

**架构：** 基础 `/ready` 与业务生产准入分离；订单、库存、Provider、OpenUI、NY 路由继续由现有深 Module 拥有。发布质量由仓库脚本和 CI 统一门控，生产开关只在真实配置和灰度证据完备后逐项开启。

**技术栈：** pnpm/Turborepo、NestJS/Fastify、Prisma/PostgreSQL、Redis、Vitest、Playwright、Zeabur、OpenUI/Xray。

## 全局约束

- 不修改 `apps/web` 的页面、样式、交互和文案。
- 不提交、打印或保存任何真实 password、API key、App Secret、JWT secret 或 encryption key。
- 不使用 Mock/假库存/默认价格进入生产路径。
- 不在真实灰度前打开全局采购、投影、支付或 Bark 开关。
- 不回退或覆盖工作树中现有 119 项专线实现。

### Task 1：凭据泄漏防护

**文件：**

- 修改：`apps/api/src/common/crypto/aes-gcm.spec.ts`
- 新建：`scripts/secret-scan.mjs`
- 新建：`scripts/secret-scan.spec.mjs`
- 修改：`package.json`
- 修改：`.gitignore`

**接口：** `pnpm security:secrets` 扫描 tracked 文件和暂存内容，命中高置信 secret 时非零退出，只输出规则名和文件路径。

- [ ] 先写 secret scan 测试，使用合成凭据 fixture 验证命中、脱敏和正常文本通过。
- [ ] 运行测试确认因脚本不存在而失败。
- [ ] 实现扫描脚本并用合成 fixture 使测试通过。
- [ ] 把 AES 测试中的真实 985 key/zone 替换成明显虚构的固定向量。
- [ ] 运行仓库扫描，确认当前文件树不再包含已暴露凭据指纹。
- [ ] 记录 Git 历史仍需在远端冻结窗口中清理，当前阶段不擅自重写共享历史。

### Task 2：运行时依赖安全升级

**文件：**

- 修改：`apps/api/package.json`
- 修改：`apps/worker/package.json`
- 修改：`pnpm-lock.yaml`

**接口：** Nest 11、Fastify 5 内同主版本升级；不升级 React、Prisma 或其他无关主版本。

- [ ] 保存升级前 `pnpm audit --prod` 结果作为 RED 证据。
- [ ] 升级 Nest 11 到已修复版本、Fastify 5 到已修复版本，并使 `@fastify/static` 满足 Nest peer contract。
- [ ] 运行 API/worker typecheck、lint、test、build。
- [ ] 运行 `pnpm audit --prod`，critical/high 必须为零；若剩余漏洞来自不在运行路径的工具，逐项形成可验证例外，不允许整体忽略。

### Task 3：生产 OpenAPI 暴露门禁

**文件：**

- 修改：`apps/api/src/common/config/env.schema.ts`
- 修改：`apps/api/src/main.ts`
- 修改：`apps/api/src/common/config/config-guard.ts`
- 修改：`apps/api/src/common/config/config-guard.spec.ts`
- 修改：`apps/api/src/modules/openapi/tests/openapi-setup-integration.spec.ts`
- 修改：`.env.example`

**接口：** `OPENAPI_EXPOSURE_ENABLED` 默认 `false`；仅非生产或显式启用时注册公网文档。离线 contract 导出继续直接调用 `setupSwagger()`。

- [ ] 写生产环境默认不注册 OpenAPI、显式启用才注册的失败测试。
- [ ] 运行聚焦测试确认当前实现失败。
- [ ] 添加配置与 bootstrap 条件，保持测试/导出 API 不变。
- [ ] 运行 OpenAPI、predeploy smoke 和 config guard 测试。

### Task 4：业务生产准入 Module

**文件：**

- 新建：`apps/api/src/modules/production-readiness/production-readiness.repository.ts`
- 新建：`apps/api/src/modules/production-readiness/production-readiness.use-case.ts`
- 新建：`apps/api/src/modules/production-readiness/production-readiness.controller.ts`
- 新建：`apps/api/src/modules/production-readiness/production-readiness.module.ts`
- 新建：对应 unit/integration tests
- 修改：`apps/api/src/app.module.ts`
- 更新：OpenAPI contracts 生成物（仅 API contract，不改前端页面）

**接口：** `GET /api/admin/production-readiness` 仅 PLATFORM_ADMIN 可访问，返回 `ready/checks/checkedAt`，检查真实价格、Provider、fresh inventory、placement、node、inbound、route、主备域名、Bark 和执行开关。

- [ ] 写 use case RED 测试，证明空生产数据逐项失败且响应不含 secret。
- [ ] 写真实 PostgreSQL integration RED 测试，证明完整 fixture 才能 `ready=true`。
- [ ] 实现只读 repository 和 use case，不吞数据库错误。
- [ ] 增加管理员 controller/RBAC，并验证 USER/TENANT_ADMIN 被拒绝。
- [ ] 保持 `/ready` 只检查 PostgreSQL/Redis，并补测试说明二者语义不同。

### Task 5：CI、发布追溯、备份和回滚门

**文件：**

- 新建：`.github/workflows/production-gate.yml`
- 新建：`scripts/verify-release-metadata.mjs` 及测试
- 新建：`scripts/backup-postgres.ps1`
- 新建：`scripts/restore-postgres.ps1`
- 新建：`docs/deployment/production-runbook.md`
- 修改：`scripts/predeploy-check.mjs`
- 修改：`package.json`

**接口：** CI 串行执行 secret scan、frozen install、audit、generate、typecheck、lint、tests、integration、build、E2E；发布要求 clean tree、commit SHA 和 image digest。备份脚本生成带校验和的 PostgreSQL custom-format dump，恢复只允许显式目标数据库。

- [ ] 为 release metadata 和备份目标校验写 RED 测试。
- [ ] 实现脚本，使无 commit/digest、工作树脏或危险恢复目标时 fail closed。
- [ ] 建立 PostgreSQL/Redis service 的 CI integration/E2E job。
- [ ] 编写执行开关、灰度、回滚、备份恢复和事故处置 runbook。
- [ ] 在隔离测试库完成一次 backup -> restore -> 数据校验演练。

### Task 6：全量质量门稳定化

**文件：** 只修改导致测试泄漏/挂起的测试基础设施；不修改五月版 UI 行为。

- [ ] 使用 Vitest handle/timeout 证据定位完整 web suite 超时根因。
- [ ] 先写能稳定复现资源泄漏或顺序依赖的测试/诊断。
- [ ] 只修测试隔离或共享资源生命周期，不改变页面行为。
- [ ] 串行通过 root typecheck、lint、test、build、API integration 和 Playwright E2E。
- [ ] 运行 `git diff --check`、secret scan 和生产依赖 audit。

### Task 7：生产配置与单客户灰度

**文件/系统：** Zeabur secret、生产 PostgreSQL 管理接口、OpenUI 节点、DNS/NY 快照；不把 secret 写入仓库。

- [ ] 用户轮换服务器、985、ipipd、JWT 和 encryption credentials，并通过 secret store 注入。
- [ ] 用户确认 SV/ZB 真实价格后通过管理员 API 写入价格规则。
- [ ] 创建并健康检查一个 Provider 账号，完成 SK5 库存同步。
- [ ] 注册香港 OpenUI 节点、Inbound profile、placement policy、主备域名和 NY route snapshot。
- [ ] 先启用 Bark 并发送测试通知，再启用库存同步。
- [ ] 只对白名单 Provider/账号和一个测试客户启用订单与投影，限制数量和金额。
- [ ] 验证缺货时 Provider purchase 调用为零且 Bark 到达。
- [ ] 完成一笔真实测试订单，验证 OpenUI observed version、VLESS/VMess 握手、出口国家、限速和持续连接。
- [ ] 验证续费、暂停/恢复、显式迁移、停用与回滚。

### Task 8：最终生产审计

**证据：** Trellis evidence、CI run、Zeabur read-back、数据库只读查询、协议客户端记录、备份恢复记录。

- [ ] 逐条对照 PRD、生产整改设计和本计划，标记强证据而不是“未发现问题”。
- [ ] 确认生产 Git remote、branch、commit、image digest 和 migration 一致。
- [ ] 确认监控覆盖 API、worker、库存 freshness、节点、route、Bark outbox 和队列积压。
- [ ] 生产准入接口 `ready=true`，灰度真实 E2E 全部通过，无未处理 P0/P1。
- [ ] 提交并推送全部源码和文档，再按 Trellis 流程归档任务。

