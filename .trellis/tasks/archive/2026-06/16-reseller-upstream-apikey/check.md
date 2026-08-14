# Task 16 检查记录

## 已通过

- `pnpm --filter @ipeasy/db generate`
- `pnpm --filter @ipeasy/api typecheck`
- `pnpm --filter @ipeasy/api lint`
- `pnpm --filter @ipeasy/api test`
- `pnpm --filter @ipeasy/api build`
- `pnpm --filter @ipeasy/api export:openapi`
- `pnpm --filter @ipeasy/contracts generate`
- `pnpm --filter @ipeasy/contracts typecheck`
- `git diff --check`
- 生成契约敏感词检索：`credentialEncrypted` / `apiKeyEncrypted` / 测试明文密钥未出现在 OpenAPI 或 generated API。
- 入口校验补强后已重跑：`api typecheck` / `api lint` / `api test` / `api build` / `git diff --check`。

## 受环境阻塞

- `pnpm --filter @ipeasy/api test:integration`
- 失败原因：当前 shell 未提供有效 `DATABASE_URL` / `DATABASE_URL_TEST`，`env.schema.ts` 在测试收集阶段报 `DATABASE_URL: Invalid url` 并退出；13 个 integration spec 未进入用例执行。
- 需要真实 PostgreSQL 后重跑：
  - `$env:DATABASE_URL_TEST='postgresql://ipipx:ipipx@localhost:15432/ipipx'`
  - `$env:DATABASE_URL='postgresql://ipipx:ipipx@localhost:15432/ipipx'`
  - `$env:REDIS_URL='redis://localhost:6379'`
  - `pnpm --filter @ipeasy/api test:integration`
