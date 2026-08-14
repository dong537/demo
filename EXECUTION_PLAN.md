# IPIPX 重写执行计划

本文是本仓库的执行计划。依据腾讯云文章《Superpowers 实战指南：7 步流程 + 14 个技能 + 3 条铁律》设置工作流，并结合 `PRD.md` 与 `REWRITE_PROJECT_PROMPT.md` 执行。

## 0. 场景判定

当前目录只有产品文档与重写提示词，且 `REWRITE_PROJECT_PROMPT.md` 明确要求“从零重写”“先做蓝图和工程骨架，再写业务代码”。因此本项目按 Superpowers 的“从零开始新项目 / 老项目重写”场景执行完整 7 步流程：

```txt
brainstorming -> using-git-worktrees -> writing-plans -> subagent-driven-development -> test-driven-development -> requesting-code-review -> finishing-a-development-branch
```

修 bug 才使用 `systematic-debugging -> test-driven-development -> verification-before-completion` 三步精简流程；本轮不是 bug 修复，不适用。

## 1. 铁律

1. 没有失败测试，不写生产代码。
2. 没有根因调查，不修 bug。
3. 没有新鲜验证证据，不声明完成。

补充项目硬门禁：

- 不写 mock、memory mock DB、假数据、假 UI、假订单、假库存、假余额、假权限。
- 不复制旧项目 `App.tsx`、`styles.css`、placeholder/fallback 运行路径。
- 不在生产路径用 catch 返回空数组、默认成功、默认价格、默认余额。
- 不绕开统一 schema/OpenAPI、RBAC、Prisma migration、Provider Registry、审计日志。

## 2. 第一步：brainstorming

目标：先完成设计蓝图并获得用户批准，不直接编码。

必须产出：

- `docs/BLUEPRINT.md`：目标、用户、成功标准、明确不做什么。
- 核心域模型、Source of Truth、关键流程。
- 技术栈决策与理由。
- 前端 Public / Customer / Admin 信息架构、页面模板、数据流。
- 后端 Module 边界、统一 contract、错误与日志。
- i18n、权限、审计、监控、测试、部署、发布。
- 仓库骨架、目录树、待定项、风险与验证方式。

执行规则：

- 逐个提出高影响问题，不一次性甩大量问题。
- 至少给出 2-3 个关键方案或取舍点供审阅。
- 用户批准蓝图前，不启动工程初始化和业务实现。

## 3. 第二步：using-git-worktrees

目标：创建隔离开发空间，避免重写过程污染主目录。

当前前置状态：

- 当前目录尚未初始化 Git。
- `rtk` 本机不可用，后续命令使用原生命令，并在结果中记录该限制。

必须执行：

1. 初始化 Git 仓库。
2. 创建 `.gitignore`，覆盖 `node_modules`、`.env*`、构建产物、测试产物、日志、缓存。
3. 初始化 Trellis：

   ```bash
   trellis init --codex --claude --opencode -u rewrite-residential-proxy-platform
   ```

4. 填充真实 spec，不能停留模板：

   ```txt
   .trellis/spec/architecture.md
   .trellis/spec/api-contract.md
   .trellis/spec/database.md
   .trellis/spec/frontend-ui-ux.md
   .trellis/spec/security-permissions.md
   .trellis/spec/testing-deployment.md
   .trellis/tasks/rewrite-blueprint.md
   ```

5. 创建开发 worktree。
6. 在 worktree 内运行环境基线检查。

## 4. 第三步：writing-plans

目标：把批准后的蓝图拆成可执行的小任务。

计划要求：

- 每个任务控制在 2-5 分钟粒度。
- 每个任务必须写明精确文件路径。
- 每个任务必须写明完整实现要求，不允许 TBD、TODO、占位描述。
- 每个任务必须写明验证步骤。
- 任务必须落到 Trellis task 中，聊天记录不作为唯一状态源。

第一阶段任务顺序严格按 `REWRITE_PROJECT_PROMPT.md`：

1. Monorepo 初始化。
2. Trellis spec 完成。
3. PostgreSQL + Prisma schema/migration。
4. OpenAPI 生成与前端类型生成。
5. Auth/APIKey/RBAC。
6. Wallet/Payment/Ledger 单币种链路。
7. Admin 最小页面：登录、用户列表、钱包流水、支付单、审计日志。
8. Customer 最小页面：登录、余额、充值单、流水。
9. 测试覆盖权限、资金、错误传播。

第一阶段完成后，才进入代理购买和 Provider 履约。

## 5. 第四步：subagent-driven-development

目标：每个任务独立执行、独立审查，减少上下文污染。

执行规则：

- 每个任务只给子代理必要上下文、目标文件和验证命令。
- 子代理产出后必须做两类审查：规范合规审查、代码质量审查。
- 审查不通过则打回重做。
- 多个无依赖任务可使用并行代理；存在顺序依赖时串行推进。
- 主 Agent 负责整合结果和最终决策，不把分支判断外包。

## 6. 第五步：test-driven-development

目标：按 RED -> GREEN -> REFACTOR 推进。

执行规则：

- 改 domain/use case/权限/资金/库存/价格/订单/Provider/API 前，先写失败测试。
- RED：测试必须先失败，证明行为或 bug 被捕获。
- GREEN：写最少生产代码让测试通过。
- REFACTOR：清理实现，保持测试通过。

关键必测：

- USER 不能访问 `/system/*`。
- tenant admin 不能跨 tenant。
- platform admin 操作产生 audit log。
- DB 故障不能变成空列表或业务未配置。
- 非平台币种不能进入资金链路。
- 支付确认必须写 wallet + ledger + audit。
- 购买失败不会生成假代理。

## 7. 第六步：requesting-code-review

目标：实现完成后自动审查，再修复问题。

审查维度：

- 是否遵守蓝图、PRD、Trellis spec。
- 是否存在 mock/fallback/silent failure。
- 是否存在浅 wrapper、上帝组件、散落权限、散落契约。
- 是否绕开 Prisma migration、OpenAPI schema、Provider Registry、统一 RBAC。
- 是否有真实测试覆盖与新鲜验证证据。
- 是否引入不必要依赖或偏离现有技术栈。

## 8. 第七步：finishing-a-development-branch

目标：所有验证通过后收尾，不用“代码写完了”冒充完成。

完成前必须提供新鲜验证证据：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

涉及 UI：

```bash
pnpm e2e
```

涉及 DB：

```bash
pnpm prisma migrate dev
pnpm test:integration
```

生产 smoke：

```bash
curl -fsS https://api.ipipx.365proxy.net/health
curl -fsS https://api.ipipx.365proxy.net/ready
curl -fsS https://ipipx.365proxy.net/healthz
curl -fsS https://api.ipipx.365proxy.net/openapi.json
```

收尾选项：

- 合并到基础分支。
- 创建 PR。
- 保留分支。
- 丢弃分支。

无论选择哪项，都必须记录验证结果、剩余风险和回滚策略。

## 9. 下一步门禁

下一步只能进入 brainstorming 阶段，产出蓝图草案、不创建假数据、不搭 UI 壳、不绕过 Trellis。
