# 验证记录

日期：2026-08-14（Asia/Shanghai）

## 本地物理备份

- 清单：1,591 项，1,560 个文件，`9,730,640,020` 字节；所有文件存在且大小与清单一致。
- PG_VERSION：18；控制文件版本：1800；数据校验和版本：1。
- WAL：23 个连续 16MB 段，从 `000000010000002E00000071` 到 `...7F`。
- 首次启动缺少 14 个空运行目录；仅在隔离 Docker 副本补齐后重试。
- PostgreSQL 18 crash recovery：redo `2E/7126ECE0` -> `2E/87FFD280`，checkpoint 完成，`ready to accept connections`。
- `pg_is_in_recovery()`：`false`。
- `pg_amcheck --all --jobs=4 --on-error-stop`：960 relations / 1,054,516 pages，退出码 0。
- `pg_checksums --check`：1,424 files / 1,138,015 blocks，坏 checksum 0。

## 逻辑备份与回灌

- `globals.sql` + `railway.dir` directory-format dump：约 1.2GB，`pg_restore --list` 通过。
- SHA-256 清单：33 个导出文件，0 个失败。
- 全新 PostgreSQL 18 实例回灌：`pg_restore --jobs=4 --exit-on-error --no-owner` 完成。
- 31 张 public 表逐表行数比较：0 差异。
- public 约束：350 -> 350；索引：57 -> 57；有效 Prisma migrations：14 -> 14。
- 注意：globals.sql 在全新实例第一次执行时遇到已存在的 `postgres` role；该错误不影响随后业务库回灌，但生产导入必须使用幂等角色处理或按目标库已有角色跳过该行，并单独比较角色属性。

## Railway 当前状态

- `Postgres-CVre`（10GB）崩溃，日志为 WAL 临时文件 `No space left on device`。
- `Postgres`（5GB）没有活动部署，容量不足以容纳恢复后的约 8.87GB 业务库。
- GraphQL schema 没有卷大小更新字段；CLI `volume update` 仅支持名称/挂载路径。
- `volumeInstanceBackupCreate` 和既有备份恢复操作对当前账号返回 `Not Authorized`。
- 因此尚未删除、覆盖或切换任何 Railway 数据卷。

## 服务变量与前端冻结

- backend 67 个键、worker 26 个键、frontend 17 个键均可读；生产模式和危险开发兼容开关已为 false。
- `PROVIDER_FULFILLMENT_EXECUTION_ENABLED=false`、`PROVIDER_LIFECYCLE_EXECUTION_ENABLED=false`、`PAYMENT_CONFIRMATION_ENABLED=false`，库存同步仍启用。
- Git 基线确认 `apps/web/**` 未修改；该范围继续冻结。

## Railway logical restore (2026-08-14)

- The old 10GB volume `3de8ab2d-aca1-4ac8-b64c-c7912d35594b` was reset only after the local physical backup and fresh logical restore were verified. The reset removed the old volume contents; recovery sources remain in the verified local backup and private Railway Object Storage bucket.
- Private bucket `postgres-recovery-staging` contains 18 verified payload objects plus a signed manifest. Total payload bytes: `1287792855`; manifest bytes: `12015`; manifest SHA-256: `bf8dc93d8abda956e7e60d94478f232a2f9aca5f10483be61198073344bff538`.
- Railway recovery deployment `f809d934-0b88-4536-8621-81d4314136df` completed with `RESTORE_COMPLETE` on the volume-mounted maintenance service. The deployment was split into pre-data/data and post-data phases to remove dump files before index construction.
- Railway checks passed: `public_tables=31`, `public_constraints=350`, `public_indexes=57`, `valid_migrations=14`, `users=15`, `orders=5`, `proxy_instances=2`, `provider_accounts=3`, `resource_mappings=216736`, `fulfillment_jobs=5`, `inventory_snapshots=27232469`, `audit_logs=241`.
- PostgreSQL final process is listening on `0.0.0.0:5432`. The maintenance service remains isolated; application services are not yet pointed to it.
- Frontend remains frozen: no `apps/web/**` file changed.

## Production deployment verification (2026-08-14)

- Backend Railway deployment `0cae931c-7e9f-4cc7-8e3e-1dee23295510` succeeded after 18 Prisma migrations; `/health` returned 200 with release SHA `20e87d14675178bf2c05dd9ca5492e38861847a3`, and `/ready` returned `db.ok=true` and `redis.ok=true`.
- Recovered PostgreSQL maintenance deployment `ed4b7659-89b8-4d94-ba92-67c097751935` is running and restricted to Railway private-network clients.
- Redis deployment `dd275d54-1afe-46f3-828d-8fd37687d742` succeeded; backend readiness confirms the connection.
- Worker deployment `3be6ac60-8b29-4461-bfff-1e08eb316bb4` succeeded. Recent logs show fulfillment, inventory sync, dedicated-line order, projection, migration, and Bark outbox workers are explicitly disabled. No recent worker error records were found.
- Frozen frontend deployment `6bc86770-7d3b-4b97-b9fa-64c7cb3e0ea3` succeeded at `https://frontend-production-1870.up.railway.app`. `/healthz`, `/`, and `/proxy/dedicated/buy` returned 200; the root index SHA matched the frozen manifest (`3e1f90ae6132b7859442d692baecaa303eac2896e30ce8d04ac2a873230b2386`).
- Browser smoke evidence is under `evidence/railway-production-smoke/` for desktop 1440x900, mobile 390x844, and mobile 320x844. The frozen SPA rendered without runtime/page errors; the only external request failure was Google Fonts. The two mobile fixtures retain the original 395px horizontal overflow and were not changed because frontend bytes are frozen.
- Direct navigation to `/proxy/dedicated/buy` without a session redirected to `/?redirect=/proxy/dedicated/buy`, which is expected auth behavior. The login page rendered, but the frozen bundle requests `https://backend-test-0dcb.up.railway.app/api/v1`; from the production frontend origin the old service returned no `Access-Control-Allow-Origin`, so browser login is blocked by CORS. The current production backend exposes `/api/...` and returned 404 for `/api/v1/settings/capabilities`; this is a frontend/backend contract blocker, not a static-serving failure.
- Current production is therefore not approved for customer traffic: credentials must be rotated, provider/3x-ui/NY/Bark smokes are still pending, the frozen frontend must be pointed at a compatible API without editing `apps/web/**`, and durable backup/monitoring/rollback operations must be established before enabling execution workers.

## Old Railway backend investigation (2026-08-15)

- The user-owned old project `fba9046c-e92e-462c-a695-0751efc46a10` was inspected to recover the frozen frontend contract. Its test backend `ec1a6b7f-cdd8-44f2-8b8c-6da6284d5fad` at `backend-test-0dcb.up.railway.app` returned 200 for `/api/v1/health` and `/api/v1/settings/capabilities`; unauthenticated dedicated catalog requests returned 401. This confirms the old `/api/v1` route family is the contract expected by the frozen bundle.
- Old service logs repeatedly showed 3x-ui preflight/traffic timeouts, dedicated deployment failures, and order auto-repair activity. It must not be promoted or used as a production fallback until connectivity, credentials, and order idempotency are fixed.
- Railway build logs exposed the old build layout (`backend/Dockerfile.railway`, `packages/proxyhub-sdk`, `reseller-backend`, Prisma build steps) but no source commit or archive. Railway SSH attempts timed out during the SSH banner exchange, so source extraction is currently blocked by the Railway/network path. Details are in `research/old-backend-recovery.md`.
- This leaves the current production gate unchanged: workers remain disabled and customer traffic is not approved. Preserving the frozen frontend requires a compatible `/api/v1` backend recovery/rebuild; changing `apps/web/**` would be a separate explicitly authorized decision.

## Final online recheck (2026-08-15)

- Current backend `https://backend-production-43893.up.railway.app/health` returned 200 with release SHA `20e87d14675178bf2c05dd9ca5492e38861847a3`.
- Current backend `/ready` returned 200 with both database and Redis checks healthy.
- Current frontend `https://frontend-production-1870.up.railway.app/healthz` returned 200.
- Current worker logs still report `fulfillment_worker_disabled`, `inventory_sync_worker_disabled`, `dedicated_line_order_worker_disabled`, `bark_outbox_worker_disabled`, `dedicated_line_projection_worker_disabled`, and `dedicated_line_migration_worker_disabled`.
- Railway `service files list` against the old backend timed out during the remote session, matching the earlier SSH banner timeout. No source archive was recovered and no old service was modified.
- The old project's production environment was checked and contains only a stopped/failed `ipipd-panel`; it has no backend/frontend deployment that can be promoted as a compatible rollback.

## Frozen frontend compatibility verification (2026-08-15)

- The full 19-migration chain applied successfully to isolated PostgreSQL schema `codex_compat_20260815` in the old Railway test database. Production and the existing `public` schema were not truncated or modified by integration tests.
- Real PostgreSQL `/api/v1` integration tests passed 5/5: raw capabilities, login/refresh rotation, real SKU quote, out-of-stock rejection with one Bark outbox event and zero provider jobs, and scoped UUID-to-numeric legacy line projection with remark persistence.
- Root typecheck and lint passed. API unit suite passed 102 files / 609 tests. The legacy proxy passed forwarding, health, 413 body limit, and 502 upstream-unavailable tests.
- Secret scan passed 1,492 files. `git diff --name-only -- apps/web frozen/frontend-railway-6f71aaa1` remained empty.
- Production backend variables now explicitly set `LEGACY_API_V1_ENABLED=true`, `LEGACY_API_SITE_ID=61be22a2-4bce-4282-afe8-8d57c9faf921`, and allow both current and frozen frontend origins. Variable changes were staged with deploys skipped pending the verified code release.
- External provider, 3x-ui, NY forwarding, projection, migration, and Bark execution workers remain disabled. They require separate real-upstream smoke approval.
