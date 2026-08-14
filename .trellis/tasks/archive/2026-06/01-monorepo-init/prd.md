# Task 01 — Monorepo 初始化

## 目标

建立 pnpm workspace + Turborepo 仓库骨架，使后续每个 app 和 package 可独立构建、独立测试，且所有 TypeScript 配置、lint 规则从共享包继承。

## 实现要求

### 根目录

**package.json**
- `name: "ipeasy-platform"`, `private: true`
- scripts: `build`, `typecheck`, `lint`, `test`, `e2e`, `dev`，全部通过 `turbo run` 转发
- devDependencies: `turbo`, `pnpm`（engines 约束 node>=20, pnpm>=9）

**pnpm-workspace.yaml**
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

**turbo.json**
- pipeline: `build`（dependsOn: `^build`，outputs: `dist/**`）、`typecheck`、`lint`、`test`（cache: true）、`dev`（cache: false, persistent: true）

**.env.example**
- 完整复制 `REWRITE_PROJECT_PROMPT.md` 中的 `.env.example` 模板，不遗漏任何变量
- 所有 secret 字段值留空或注释标注 `replace-with-real-value`

**.gitignore**
- node_modules, dist, .turbo, .env, .env.local, .env.*.local, *.log, coverage, .next, playwright-report, test-results

**docker-compose.yml**
- services: `postgres`（image: postgres:16-alpine，port: 15432），`redis`（image: redis:7-alpine，port: 6379）
- 不包含 app 服务（本地开发各 app 独立 `pnpm dev`）
- volumes 持久化

**README.md**
- 一段说明：项目定位、技术栈、本地启动步骤（`docker-compose up -d` -> `pnpm install` -> `pnpm dev`）

### packages/tsconfig

**tsconfig.base.json**
- target: ES2022, module: NodeNext, strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true
- 不包含 paths 和 include/exclude（各 app 自行 extends 并添加）

**package.json**: `name: "@ipeasy/tsconfig"`, no main

### packages/eslint-config

**index.js**
- extends: `eslint:recommended`, `@typescript-eslint/recommended`
- rules: no-console warn（allow `console.error`），no-explicit-any error，@typescript-eslint/no-floating-promises error

**package.json**: `name: "@ipeasy/eslint-config"`, peerDependencies: eslint, @typescript-eslint/*

### apps/api

**package.json**
- `name: "@ipeasy/api"`，scripts: `dev`, `build`, `start:prod`, `typecheck`, `lint`, `test`, `test:integration`
- dependencies 占位（NestJS 主包在 task 03 安装）

**tsconfig.json**: extends `@ipeasy/tsconfig/tsconfig.base.json`，outDir: `dist`，rootDir: `src`

### apps/web

**package.json**: `name: "@ipeasy/web"`，scripts: `dev`, `build`, `start`, `typecheck`, `lint`, `test`, `e2e`

**tsconfig.json**: extends base，针对 browser 调整（lib: ES2022,DOM,DOM.Iterable）

### apps/worker

**package.json**: `name: "@ipeasy/worker"`，scripts: `dev`, `build`, `start`, `typecheck`, `lint`, `test`

### packages/db

**package.json**: `name: "@ipeasy/db"`，将在 task 02 填充 Prisma client export

### packages/contracts

**package.json**: `name: "@ipeasy/contracts"`，将在 task 04 填充 OpenAPI 生成的类型

### packages/config

**package.json**: `name: "@ipeasy/config"`，将在 task 03 填充统一配置服务

## 验证步骤

```bash
pnpm install          # 无报错
pnpm typecheck        # 无类型错误
pnpm lint             # 无 lint 错误
pnpm build            # 各包 build 成功（此时各 app 还无实际源码，空 build 通过即可）
docker-compose up -d  # postgres:15432 和 redis:6379 健康
```

## 禁止

- 不安装任何 mock、faker、json-server 依赖
- 不在任何 package.json 里写具体业务代码
- 不把 `.env.local` 的真实值写进任何文件
