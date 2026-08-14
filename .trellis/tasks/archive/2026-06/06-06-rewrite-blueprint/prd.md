# 任务 PRD：重写蓝图与工程初始化

## 目标

完成 IPIPX 家宽代理平台重写的规划与工程协作地基，进入 Superpowers 第二步 `using-git-worktrees`，但不写业务代码。

## 用户

- 产品/技术负责人：需要确认第一阶段范围、技术栈、部署路径。
- 后续编码 Agent：需要稳定的 Trellis spec、task PRD、蓝图和执行计划。

## 成功标准

- Git 仓库已初始化。
- Trellis 已初始化。
- 蓝图文档存在：`docs/BLUEPRINT.md`。
- 执行计划存在：`EXECUTION_PLAN.md`。
- Trellis 长期 spec 已填充真实内容：
  - `.trellis/spec/architecture.md`
  - `.trellis/spec/api-contract.md`
  - `.trellis/spec/database.md`
  - `.trellis/spec/frontend-ui-ux.md`
  - `.trellis/spec/security-permissions.md`
  - `.trellis/spec/testing-deployment.md`
- Trellis task 上下文指向真实 spec，不停留 `_example`。
- 创建开发 worktree，后续实施在隔离目录中进行。

## 明确不做

- 不初始化业务 monorepo。
- 不写 API、数据库 schema、前端页面或测试。
- 不创建 mock、memory mock DB、假数据或假 UI。
- 不进入代理购买和 Provider 履约。

## 决策

- 第一阶段只做真实工程骨架和资金/权限闭环，不进入代理购买与 Provider 履约。
- 推荐技术栈：pnpm workspace + Turborepo、NestJS、PostgreSQL + Prisma、Redis、OpenAPI 生成契约、React + Vite + TanStack + Ant Design。
- 部署优先 Railway，Docker Compose 作为本地/预发替代。

## 验证

- `rtk git status --short`
- `rtk trellis --version`
- `rtk python ./.trellis/scripts/task.py validate 06-06-rewrite-blueprint`
- `rtk rg --files`

## 风险

- Trellis 生成的默认 spec 目录与项目提示词要求的顶层 spec 文件并存；长期以本项目新增的 `.trellis/spec/*.md` 为项目级工程规范。
- 当前阶段无业务代码，不能运行 `pnpm typecheck/lint/test/build`。
