# 测试、验证与部署规范

## 测试策略

测试少而真。必须覆盖真实失败模式，不测 mock 调用次数冒充行为。

测试分层：

- Domain：金额、币种、状态机、权限判断、价格优先级。
- Use Case：充值确认、退款、购买、库存不足、价格缺失、上游失败。
- Repository：真实测试库验证查询语义。
- API：Supertest 覆盖 envelope、scope、tenant 边界。
- Frontend：Vitest + Testing Library 覆盖路由守卫、关键表单、错误态。
- E2E：Playwright 覆盖登录、充值、后台审计，第二阶段覆盖购买成功/失败。

第一阶段必测：

- USER 不能访问 `/system/*`。
- tenant admin 不能跨 tenant。
- platform admin 操作产生 audit log。
- DB 故障不能变成空列表或业务未配置。
- 非平台币种不能进入资金链路。
- 创建充值单不改钱包。
- 支付确认必须写 wallet + ledger + audit。

禁止：

- memory mock DB。
- 无语义大 snapshot。
- 为了通过测试放宽断言。
- 测 mock 调用次数冒充行为。

## PR 验证门禁

`packages/db/generated/` 是 Prisma 本地生成物，不进入 Git。根级门禁脚本必须先执行 `pnpm --filter @ipeasy/db generate`，再运行 Turbo 的 `lint/typecheck/test/build`，避免提交 Windows/本机 Prisma engine 二进制。

Windows 本地不要并发运行会触发 Prisma generate 的根级命令，例如同时跑 `pnpm typecheck` 和 `pnpm build`；两者都可能写入 `packages/db/generated/`，导致 Prisma engine DLL rename 出现 `EPERM`。正确做法是先单独运行 `pnpm --filter @ipeasy/db generate`，再串行执行根级门禁，或只并发不会重新生成 Prisma client 的包级检查。

每个 PR 至少运行：

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

本仓库路径包含中文时，Docker Compose 默认 project name 可能解析失败。运行本地数据库/Redis 时必须显式指定项目名：

```bash
docker compose -p ipipx up -d postgres redis
docker compose -p ipipx ps
```

API 集成测试使用真实 PostgreSQL。若未设置环境变量，`env.schema.ts` 会因为空 `DATABASE_URL` 直接失败；本地验证应显式注入：

```bash
$env:DATABASE_URL_TEST='postgresql://ipipx:ipipx@localhost:15432/ipipx'
$env:DATABASE_URL='postgresql://ipipx:ipipx@localhost:15432/ipipx'
$env:REDIS_URL='redis://localhost:6379'
pnpm --filter @ipeasy/api test:integration
```

后端契约级集成测试必须至少覆盖：

- `/health` 不走 `/api` prefix、不包业务 envelope。
- `/ready` 使用真实 PostgreSQL 和 Redis 依赖检查，成功返回 200，依赖失败返回 503。
- 未匹配的 `/api/*` 路由返回统一错误 envelope，并保留 `x-request-id`。
- `/openapi.json` 不走业务 envelope，并包含 `apikey`、bearer security schemes。

workspace 包的生产运行时入口不能指向 `.ts` 源文件。被 `apps/api`、`apps/worker` 运行时引用的包必须先编译到 `dist/`，并在 `package.json` 中声明稳定的 `main`/`types`，例如 `@ipeasy/db` 使用 `dist/index.js` 和 `dist/index.d.ts`。根级 `build/typecheck` 需要让 Turbo 先执行依赖包 build，再构建应用。

OpenAPI/contracts 生成链路必须按顺序验证：

```bash
pnpm --filter @ipeasy/api build
pnpm --filter @ipeasy/api export:openapi
pnpm --filter @ipeasy/contracts generate
pnpm --filter @ipeasy/contracts typecheck
```

本仓库路径包含中文时，禁止让 `openapi-typescript` CLI 直接解析 OpenAPI 文件路径；Redocly 解析层可能把路径 URL encode 后当本地路径读取。`packages/contracts/scripts/generate.mjs` 必须先用 Node `readFile` 读入 `openapi.json`，再把 JSON 对象传给 `openapi-typescript` API。

## 服务拓扑

优先支持 Railway，Docker Compose 作为本地/预发替代。

| 服务 | 说明 | 健康检查 |
| --- | --- | --- |
| `web` | Public / Customer / Admin 前端 | `/healthz` |
| `api` | API / OpenAPI / Auth / Use Case | `/health`、`/ready` |
| `worker` | 履约、库存同步、回调补偿、异步审计 | 无 HTTP 健康检查；通过 Railway 进程状态和日志观察 |
| `postgres` | 主数据库 | 托管健康检查 |
| `redis` | 幂等、限流、队列、短期缓存 | 托管健康检查 |

## 生产启动门禁

- `NODE_ENV=production` 显式设置。
- `DATABASE_URL` 和 `REDIS_URL` 存在。
- `APP_ENCRYPTION_KEY` 是非 placeholder 的 32-byte key。
- `JWT_SECRET` 是非 placeholder secret。
- `APP_PLATFORM_CURRENCY` 固定，第一阶段只允许单币种。
- `ALLOW_PLACEHOLDER_APIKEYS=false`。
- `ALLOW_LOCAL_DEV_APIKEY=false`。
- Provider fulfillment 开启时必须配置 allowlist。
- payment confirmation 开启前必须完成支付签名验证、人工确认 RBAC、对账和审计。

## Smoke Check

```bash
curl -fsS https://api.ipipx.365proxy.net/health
curl -fsS https://api.ipipx.365proxy.net/ready
curl -fsS https://ipipx.365proxy.net/healthz
curl -fsS https://api.ipipx.365proxy.net/openapi.json
```

本地验证 API 生产产物时必须显式注入生产启动门禁所需环境变量，再运行 `node apps/api/dist/main.js`。Nest Swagger UI 在 Fastify 适配器下需要应用包显式依赖 `@fastify/static@^8`；缺失时 `pnpm build` 可能通过，但生产产物启动会在 `setupSwagger()` 阶段失败。

## 回滚

- 应用版本可回滚，数据库 migration 不回滚。
- 数据库问题用 forward-only corrective migration。
- Provider 事故优先关闭 `PROVIDER_FULFILLMENT_EXECUTION_ENABLED` 或对应 `UPSTREAM_*_STATUS=DISABLED`。
- 支付事故优先关闭 `PAYMENT_CONFIRMATION_ENABLED`。
- 事故必须保留 audit/upstream/request log，不允许清空日志掩盖问题。

## Scenario: Railway Three-Service Launch Runtime

### 1. Scope / Trigger

- Trigger: deploying API, Web, and fulfillment worker services to Railway or changing production runtime env/config.
- Applies to `apps/api/railway.json`, `apps/web/railway.json`, `apps/worker/railway.json`, `.railwayignore`, frontend API base URL handling, backend CORS, and fulfillment worker execution gates.

### 2. Signatures

- Backend config: `apps/api/railway.json`.
- Frontend config: `apps/web/railway.json`.
- Worker config: `apps/worker/railway.json`.
- Backend start: `NODE_ENV=production pnpm --filter @ipeasy/api start:prod`.
- Frontend start: `pnpm --filter @ipeasy/web start`, serving `dist/` and `/healthz` on Railway `PORT`.
- Worker start: `NODE_ENV=production pnpm --filter @ipeasy/worker start`.
- Frontend env: `VITE_API_BASE_URL=/api`.
- Frontend proxy target env: `WEB_API_PROXY_TARGET=https://<backend-domain>`.
- Backend env: `CORS_ORIGINS=https://<frontend-domain>[,...]`.
- Worker env: `PROVIDER_FULFILLMENT_EXECUTION_ENABLED`, `PROVIDER_FULFILLMENT_PROVIDER_ALLOWLIST`, `PROVIDER_FULFILLMENT_UPSTREAM_ACCOUNT_ALLOWLIST`, `WORKER_FULFILLMENT_POLL_INTERVAL_MS`, `WORKER_FULFILLMENT_BATCH_SIZE`.
- Worker inventory env: `PROVIDER_INVENTORY_SYNC_ENABLED` (defaults to `true`; set `false` only for intentional maintenance), `WORKER_INVENTORY_SYNC_INTERVAL_MS`, `DATABASE_INVENTORY_FRESHNESS_MS`.

### 3. Contracts

- Do not rely on a root `railway.json` for multi-service deploys. Each Railway service must point to its own config path.
- Backend CORS is explicit. Empty `CORS_ORIGINS` means CORS is not enabled; there is no localhost or wildcard fallback in production.
- Web API requests in the browser must use the same-origin `/api` proxy on Railway, while `WEB_API_PROXY_TARGET` drives the frontend server proxy to the backend service. Relative `/api/*` remains valid for local/test setups.
- Worker is a background process. It must not expose HTTP traffic or use the API service start command.
- Real fulfillment requires both `PROVIDER_FULFILLMENT_EXECUTION_ENABLED=true` and at least one allowlist entry in provider or upstream-account allowlist. Startup must fail in production if execution is enabled with both allowlists empty.
- Real inventory sync requires enabled provider accounts in the database and a running worker service. Keep `PROVIDER_INVENTORY_SYNC_ENABLED=true`, and set `WORKER_INVENTORY_SYNC_INTERVAL_MS` lower than `DATABASE_INVENTORY_FRESHNESS_MS`; production startup fails when inventory sync is enabled but the interval reaches or exceeds the freshness TTL.
- `.railwayignore` must exclude local env files, build outputs, coverage, test artifacts, temp files, logs, and generated Prisma client artifacts.

### 4. Validation & Error Matrix

- Missing `WEB_API_PROXY_TARGET` in Railway frontend production -> the server proxy cannot reach the backend and `/api/*` fails visibly.
- Missing backend `CORS_ORIGINS` only matters if a deployment intentionally uses split-origin direct browser-to-backend requests; do not add silent wildcard fallback.
- `PROVIDER_FULFILLMENT_EXECUTION_ENABLED=false` -> worker logs disabled and does not scan queued jobs.
- `PROVIDER_INVENTORY_SYNC_ENABLED=false` -> worker logs disabled and does not scan provider accounts.
- `PROVIDER_INVENTORY_SYNC_ENABLED=true` with no enabled provider accounts -> worker stays online and writes no fake inventory.
- Provider account sync failure -> worker logs the failed account and continues other accounts; do not mark inventory successful or create placeholder rows.
- `PROVIDER_FULFILLMENT_EXECUTION_ENABLED=true` plus empty allowlists -> `ConfigGuard` exits during production startup.
- Allowlist configured but provider/account not matched -> fulfillment use case returns `UPSTREAM_DISABLED / provider_not_allowed_for_fulfillment` and no upstream buy occurs.

### 5. Good/Base/Bad Cases

- Good: `backend`, `frontend`, and `worker` Railway services each use their package-scoped config path.
- Good: `frontend` sets `VITE_API_BASE_URL=/api` and `WEB_API_PROXY_TARGET` to the backend domain.
- Base: local same-origin/proxy tests leave `VITE_API_BASE_URL` empty and request `/api/*`.
- Bad: root `railway.json` starts the API command for every service.
- Bad: enabling real fulfillment with no allowlist, relying on operator memory to avoid accidental real purchases.

### 6. Tests Required

- API: `pnpm --filter @ipeasy/api test` for `ConfigGuard`, allowlist, CORS helper, and API behavior touched by runtime env.
- Worker: `pnpm --filter @ipeasy/worker typecheck`, `lint`, `test`, and `build`.
- Web: `pnpm --filter @ipeasy/web typecheck`, `lint`, `test`, and `build`.
- Root gate: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Integration when DB/Redis are available: set real `DATABASE_URL_TEST`, `DATABASE_URL`, `REDIS_URL`, a 64-hex `APP_ENCRYPTION_KEY`, then run `pnpm --filter @ipeasy/api test:integration`.

### 7. Wrong vs Correct

#### Wrong

```json
{
  "deploy": {
    "startCommand": "NODE_ENV=production pnpm --filter @ipeasy/api start:prod"
  }
}
```

Using the same root Railway config for worker and frontend makes service behavior drift or start the wrong process.

#### Correct

```txt
backend  -> apps/api/railway.json
frontend -> apps/web/railway.json
worker   -> apps/worker/railway.json
```

## Scenario: Railway CLI Monorepo Upload

### 1. Scope / Trigger

- Trigger: direct production deployment through `railway up` from this pnpm/turbo monorepo.
- Applies when deploying `backend`, `frontend`, or `worker` from the local working tree instead of relying on Railway GitHub deploy settings.

### 2. Signatures

- Backend CLI deploy: `railway up --service backend --environment production --no-gitignore --message "deploy backend"`.
- Frontend CLI deploy: `railway up --service frontend --environment production --no-gitignore --message "deploy frontend"`.
- Worker CLI deploy: `railway up --service worker --environment production --no-gitignore --message "deploy worker"`.
- CLI manifest source for direct upload: root-level `/railway.json` inside the uploaded archive.
- Package configs:
  - `apps/api/railway.json`
  - `apps/web/railway.json`
  - `apps/worker/railway.json`

### 3. Contracts

- For direct `railway up` uploads from the repository root, Railway CLI must see a root `railway.json` in the uploaded archive. Do not assume it will automatically read `apps/*/railway.json`.
- The package-scoped configs remain the source of truth in Git. A root `railway.json` may be created only as a temporary deployment shim and must be deleted before commit.
- Because `/railway.json` is intentionally ignored by Git, direct local uploads must pass `--no-gitignore` while the temporary root manifest exists.
- The repository root must not contain a generic `Dockerfile`. Railway can prefer it for every service, which makes backend deploys run the frontend image. Service-specific Dockerfiles stay under `apps/*`, and service configs must point to the intended Dockerfile path.
- Do not use `railway up apps/api --path-as-root` with the current configs: the build commands run from the pnpm workspace root and require the full monorepo.
- After each upload, inspect the deployment metadata. A valid deployment has `configFile=/railway.json` and a non-empty `fileServiceManifest`.

### 4. Validation & Error Matrix

- `fileServiceManifest={}` or `configFile` is missing -> CLI did not upload/read the intended config; stop, restore the temporary root `railway.json`, use `--no-gitignore`, and redeploy the service.
- Backend `/health` returns frontend HTML -> a root/front-end Dockerfile was deployed to the backend service; remove the root Dockerfile, keep the frontend Dockerfile package-scoped, then redeploy backend.
- CLI request timeout after upload -> poll `railway deployment list --service <service> --environment production --json`; the deployment may still have been created.
- Railway GraphQL/TLS handshake failure before upload -> check the latest deployment list; if no new deployment exists, retry once.
- Temporary root `railway.json` left in the worktree -> delete it before smoke checks and commits.

### 5. Good/Base/Bad Cases

- Good: copy `apps/api/railway.json` to root `railway.json`, deploy `backend` with `--no-gitignore`, then delete or replace it for the next service.
- Good: deployment metadata shows `configFile=/railway.json` and the expected Nixpacks `buildCommand`.
- Base: Dashboard/Git deploy may use package-scoped config paths when configured there, but local CLI deploys must be verified through metadata.
- Bad: running `railway up --service backend` with no root `railway.json` and accepting a default Railpack deployment.
- Bad: committing the temporary root `railway.json` after using it as a CLI shim.

### 6. Tests Required

- Precheck: `railway status`, `railway service list`, and `git status --short --untracked-files=all`.
- Deployment status: poll `railway deployment list --service <service> --environment production --json` until `SUCCESS` or a terminal failure.
- Smoke:
  - backend `/health`
  - backend `/ready`
  - backend `/openapi.json`
  - frontend `/healthz`
- Worker: verify Railway service status is `Online` because it has no HTTP healthcheck.

### 7. Wrong vs Correct

#### Wrong

```powershell
railway up --service backend --environment production --message "deploy backend"
```

Running this with no root `railway.json` can create a failed default Railpack deployment.

#### Correct

```powershell
Copy-Item apps\api\railway.json railway.json -Force
railway up --service backend --environment production --no-gitignore --message "deploy backend"
Remove-Item railway.json
```

Use the target package config as a temporary root manifest, then remove it before committing.

## Scenario: Phase 1 Real Test Coverage

### 1. Scope / Trigger

- Trigger: auth, RBAC, wallet, payment, route guards, and browser smoke tests cross API, database, frontend state, and production bundle runtime.
- Applies to `apps/api` unit/integration tests, `apps/web` Vitest tests, and root Playwright E2E.

### 2. Signatures

- API unit: `pnpm --filter @ipeasy/api test`.
- API integration: set `DATABASE_URL_TEST`, `DATABASE_URL`, `REDIS_URL`, then run `pnpm --filter @ipeasy/api test:integration`.
- Web unit: `pnpm --filter @ipeasy/web test`.
- E2E: set the same DB/Redis env vars, then run `pnpm e2e`.
- E2E server: `node e2e/start-servers.cjs` starts `apps/api/dist/main.js` on `3301` and serves `apps/web/dist` on `4173`.

### 3. Contracts

- Integration and E2E tests must use real PostgreSQL, never a memory mock DB.
- E2E `global-setup.ts` must run migrations, truncate all tables, and seed real `site/tenant/admin/user/wallet` records.
- `DATABASE_URL_TEST` is preferred over `DATABASE_URL`; if neither exists, tests must fail loudly.
- Playwright uses `http://127.0.0.1:4173`; `/api/*` is proxied to `http://127.0.0.1:3301`.
- E2E must exercise the production bundle in `apps/web/dist`, not only Vite dev server behavior.

### 4. Validation & Error Matrix

- DB unavailable -> setup/integration test fails; do not return empty lists or default wallets.
- Missing Playwright browser -> install with `pnpm --dir apps/web exec playwright install chromium`, then re-run.
- `PAYMENT_CONFIRMATION_ENABLED=false` -> payment confirmation returns `UPSTREAM_DISABLED`.
- Confirmation-enabled tests must override config to `"true"` explicitly through the test app setup.
- `it.skip`, `test.skip`, and `describe.skip` are forbidden in phase-1 coverage.

### 5. Good/Base/Bad Cases

- Good: wallet DB failure tests break a real table and restore it in `finally`, asserting 500 envelope.
- Good: E2E logs in real seeded users, reads `321.45 CNY`, and creates a real `PENDING` payment order.
- Base: healthy empty DB list responses may return `{ total: 0, items: [] }`.
- Bad: catching Prisma failures and returning `[]`.
- Bad: skipping feature-flagged payment confirmation tests.

### 6. Tests Required

- Domain: money precision/currency and wallet amount/balance assertions.
- Auth/RBAC integration: system denial, tenant boundary, platform audit, expired/revoked sessions, invalid credentials shape, API key IP whitelist.
- Wallet/payment integration: real balance, DB outage, other-wallet denial, ledger outage, create/idempotency/confirm/adjust/audit.
- Frontend unit: login validation/errors, wallet API/permission errors, top-up `0` and negative amount blocking.
- E2E: Admin login/list, Admin unauth redirect, Customer login/wallet, Customer top-up creates `PENDING`.

### 7. Wrong vs Correct

#### Wrong

```ts
it.skip('confirms payment when upstream is enabled', async () => {});
```

This removes the funds path from the quality gate.

#### Correct

```ts
const app = await createTestApp({
  config: { PAYMENT_CONFIRMATION_ENABLED: 'true' },
});
```

Make the feature flag explicit so the confirmation path remains executable and asserted.

## Scenario: API Provider Script Type Gate

### 1. Scope / Trigger

- Trigger: code changes TypeScript scripts under `apps/api/scripts/`, especially provider operations CLI entries.

### 2. Signatures

- Default API checks:
  - `pnpm --filter @ipeasy/api typecheck`
  - `pnpm --filter @ipeasy/api lint`
- Provider script type gate:

```bash
pnpm --filter @ipeasy/api exec tsc --noEmit --pretty false --target ES2022 --module CommonJS --moduleResolution node --strict --skipLibCheck --esModuleInterop --experimentalDecorators --emitDecoratorMetadata --strictPropertyInitialization false scripts/_provider-ops.ts scripts/provider-credential.ts scripts/providers-health-check.ts scripts/providers-sync-inventory.ts scripts/providers-test-buy.ts
```

### 3. Contracts

- `apps/api/tsconfig.json` includes `src/**/*`; it does not compile `scripts/**/*.ts` during default `typecheck`.
- `apps/api` lint script is `eslint src`; type-aware `eslint scripts` currently fails unless scripts are included in a lint-aware tsconfig or ESLint override.
- Do not treat the project-service scope failure from `eslint scripts` as a code failure by itself. Run the explicit script `tsc` command when provider CLI files change.

### 4. Validation & Error Matrix

- Changed provider CLI script -> run default API checks plus provider script type gate.
- Script type gate failure -> fix script typings before committing.
- `eslint scripts` parser-scope failure -> document as tooling scope unless the task also changes lint configuration.

### 5. Good/Base/Bad Cases

- Good: `providers:test-buy.ts` includes all required `StaticProxyBuyInput` fields and passes the script type gate.
- Base: source-only backend change may rely on default API typecheck/lint/test/build.
- Bad: assuming `pnpm --filter @ipeasy/api typecheck` covered `apps/api/scripts/**/*.ts`.

### 6. Tests Required

- Unit tests stay in `src/**/*.spec.ts` so Vitest discovers them.
- Pure CLI validation logic should live under `src/modules/...` when it needs unit tests; script entry files should remain orchestration-only.

### 7. Wrong vs Correct

#### Wrong

```bash
pnpm --filter @ipeasy/api typecheck
```

This does not compile API scripts.

#### Correct

```bash
pnpm --filter @ipeasy/api typecheck
pnpm --filter @ipeasy/api exec tsc --noEmit --pretty false --target ES2022 --module CommonJS --moduleResolution node --strict --skipLibCheck --esModuleInterop --experimentalDecorators --emitDecoratorMetadata --strictPropertyInitialization false scripts/_provider-ops.ts scripts/provider-credential.ts scripts/providers-health-check.ts scripts/providers-sync-inventory.ts scripts/providers-test-buy.ts
```
