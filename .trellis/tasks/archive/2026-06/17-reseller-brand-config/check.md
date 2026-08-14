# Task 17 验证记录

## 已完成

- Prisma schema: `tenants.brandConfig Json?`
- Migration: `20260608113000_add_tenant_brand_config`
- API:
  - `GET /api/tenants/:id/brand`
  - `PUT /api/tenants/:id/brand`
- 权限:
  - public GET 只返回品牌公开字段。
  - TENANT_ADMIN 只能更新自己的 tenant。
  - PLATFORM_ADMIN 只能更新当前 site 内的 tenant。
- 审计: 更新写入 `tenant.brand.update`。
- Contracts: OpenAPI 与 `packages/contracts/src/generated/api.ts` 已重新生成。

## 检查命令

- `pnpm --filter @ipeasy/db generate`：通过
- `pnpm --filter @ipeasy/db typecheck`：通过
- `pnpm --filter @ipeasy/api typecheck`：通过
- `pnpm --filter @ipeasy/api lint`：通过
- `pnpm --filter @ipeasy/api test`：通过，13 files / 54 tests
- `pnpm --filter @ipeasy/api build`：通过
- `pnpm --filter @ipeasy/api export:openapi`：通过
- `pnpm --filter @ipeasy/contracts generate`：通过
- `pnpm --filter @ipeasy/contracts typecheck`：通过
- `git diff --check`：通过

## 阻塞项

- `pnpm --filter @ipeasy/api test:integration` 未通过：当前 shell 未配置有效 `DATABASE_URL` / `DATABASE_URL_TEST`，所有 integration suites 在 `env.schema.ts` 初始化阶段以 `DATABASE_URL Invalid url` 失败；未进入测试逻辑。

## 额外发现

- `UpdateTenantBrandConfigDto` 的 `string | null` 字段必须显式声明 `@ApiPropertyOptional({ type: String, nullable: true })`，否则生成 contracts 会漂成 `Record<string, never>`。已写入 `.trellis/spec/api-contract.md`。
