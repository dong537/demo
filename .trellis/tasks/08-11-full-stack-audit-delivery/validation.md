# 第一批后端生产闭环复核（2026-08-14）

## Findings (fixed)

- File: `apps/api/src/modules/providers/adapters/ipipd.adapter.ts`, `apps/api/src/modules/providers/adapters/nine-eight-five.adapter.ts`, `apps/api/src/modules/providers/provider-delivery-expiry.ts`
- Issue: IPIPD 仅按数字毫秒解析到期时间，数字秒会被当作 1970 年；985Proxy 的数字秒/毫秒均无法解析，官方无时区 UTC 格式会被 Node 按主机本地时区解释。两者都可能把有效交付误判为过期，或在不同时区得到不同结果。
- Fix: 新增严格共享解析器，仅接受 10 位 epoch 秒、13 位 epoch 毫秒、显式带时区日期；985Proxy 额外按其官方文档把 `YYYY-MM-DD HH:mm:ss` 解释为 UTC。缺失、无效、越界和非未来时间统一 fail-closed 为 `UPSTREAM_ERROR / provider_delivery_expiry_invalid / 502`。

- File: `apps/api/src/modules/providers/adapters/ipipd.adapter.ts`
- Issue: 原实现固定返回 HTTP；第一批修复已保留请求协议，但 IPIPD 实例的数字 protocol 字段需要按本地权威 OpenAPI 的“SOCKS5+HTTP”语义复核，不能猜成单协议冲突。
- Fix: 同步购买与后续订单查询均使用请求协议；数字协议值保留请求协议，只有可明确识别的 `HTTP`/`SOCKS5` 字符串与请求冲突时返回 `provider_delivery_protocol_mismatch`。

- File: `apps/api/src/common/config/config-guard.ts`, `apps/api/src/common/config/config-guard.spec.ts`
- Issue: `process.exit` 在测试中被 mock 成正常返回后，`verify()` 会继续检查后续条件；原断言只验证目标错误“曾出现”，无法发现一次启动校验实际记录多个错误/多次 exit。
- Fix: 每个生产致命检查在 `process.exit(1)` 后显式 `return`，保持 mocked exit 与真实 never-return 控制流一致；无 allowlist 回归测试精确断言仅一条错误和一次 exit。专线订单生产执行仍同时要求 allowlist、投影执行、库存同步、Bark 告警及 Bark key。

- File: `apps/api/src/modules/fulfillment/use-cases/fulfill-static-proxy.use-case.ts`, `apps/api/src/modules/fulfillment/use-cases/fulfill-static-proxy.use-case.spec.ts`
- Issue: 静态代理履约在已有上游订单镜像时，仅用 `upstreamOrderId` 重查订单，丢失首次购买已解析出的协议和国家；IPIPD 后续交付因此会退回默认 HTTP，破坏 SOCKS5 订单的端到端协议契约。
- Fix: 重查订单继续传递解析后的 `protocol` 与 `countryCode`，并通过公共 use case 回归测试验证已有镜像的 SOCKS5/US 输入原样进入 Adapter。

- File: `.env.example`, `.trellis/spec/backend/provider-ops-cli.md`, `.trellis/spec/testing-deployment.md`
- Issue: 联动开关和 Provider 时间格式属于易复发的部署/Adapter 隐含契约。
- Fix: `.env.example` 保持全部执行开关默认关闭并补充联动说明；长期 spec 固化协议、epoch 秒/毫秒、985 UTC、fail-closed 规则及专线订单生产联动门禁。

## Findings (not fixed)

- 无。本轮范围未执行真实 Provider 购买、3x-ui/Xray 投影或线上 smoke；生产执行门仍应保持关闭，直到外部凭据和基础设施验收完成。

## RED / GREEN 证据

- RED: `pnpm --filter @ipeasy/api exec vitest run src/common/config/config-guard.spec.ts --reporter=verbose` -> 1 failed / 10 passed；精确计数发现单次无 allowlist 校验实际调用 `console.error` 两次。
- RED: `pnpm --filter @ipeasy/api exec vitest run src/modules/providers/tests/provider-delivery-contract.spec.ts --reporter=verbose` -> 4 failed / 12 passed；IPIPD epoch 秒、985 epoch 秒/毫秒、985 UTC 无时区格式按预期失败。
- RED: `pnpm --filter @ipeasy/api exec vitest run src/modules/fulfillment/use-cases/fulfill-static-proxy.use-case.spec.ts --reporter=verbose` -> 1 failed / 3 passed；已有镜像重查仅收到 `upstreamOrderId`，未收到协议和国家。
- GREEN: `pnpm --filter @ipeasy/api exec vitest run src/modules/fulfillment/use-cases/fulfill-static-proxy.use-case.spec.ts src/modules/providers/tests/provider-delivery-contract.spec.ts src/modules/providers/tests/nine-eight-five-socks-delivery.spec.ts src/common/config/config-guard.spec.ts --reporter=verbose` -> 4 files / 33 tests passed。

## Verification

- TypeCheck: `pnpm --filter @ipeasy/api typecheck` -> pass, exit 0。
- Lint: `pnpm --filter @ipeasy/api lint` -> pass, exit 0。
- Tests: `pnpm --filter @ipeasy/api test` -> pass, 88 files / 498 tests, exit 0。
- Build: `pnpm --filter @ipeasy/api build` -> pass, exit 0。
- Diff hygiene: `git diff --check` -> pass, exit 0（仅 Git 的 LF/CRLF 工作区提示）。
- Frontend freeze: `git status --short -- apps/web` 无输出；`apps/web/dist/index.html` SHA256 = `3E1F90AE6132B7859442D692BAECAA303EAC2896E30CE8D04AC2A873230B2386`。
- Tool note: `rtk pnpm ... vitest` 两次在 Vitest 已完成后错误追加 `Command "vitest" not found` 并返回非零，按工具熔断规则改用项目原生 `pnpm` 命令；后续原生命令证据均为 exit 0。

## 专线迁移生产状态机复核（2026-08-14）

### Findings (fixed)

- OpenUI DELETE 要求 delete version 严格大于当前版本，并以持久化 `DELETED` 墓碑而非 GET 404 表示正常删除。控制面现使用 `projection.desiredVersion + 1`，接受 DELETE 404，或在 2xx/墓碑重放 409 后回读并精确确认同版本 `DELETED`；未确认前 cleanup 不释放本地投影、节点容量或出口。
- CUTOVER/CANARY/ROLLBACK 导入现在只接受迁移所属专线的一条路由；节点集合必须精确覆盖对应 TARGET/SOURCE，版本必须匹配 target/source line version，ROLLBACK 还要求源投影 READY。Commit 防御性拒绝没有关联 staged cutover route 的迁移。
- migration/projection job 的 complete/defer/fail 改为带 `LEASED + leaseOwner + desiredVersion + leaseExpiresAt > now` 的条件更新；投影 lease 达到 maxAttempts 后终止并把关联迁移提升为 `NEEDS_OPERATOR`，旧 worker 不能覆盖新 lease。
- `POST /admin/control-plane/lines/:id/migrations/:migrationId/retry` 为 PREPARE/VERIFY/CLEANUP 的 `NEEDS_OPERATOR` 提供显式人工恢复；只重排该迁移失败 job、恢复失败 APPLY 投影，并写 audit。ROLLBACK 仍要求人工路由证据。
- 生产 migration smoke runner 启动门现在同时要求 HTTPS 和非 loopback；EXIT_ONLY VERIFY 取消不再错误进入 ROLLBACK。
- NODE_ONLY 暂存投影现在通过真实 repository 使用当前 `ACTIVE` 出口分配；FULL 仍强制要求迁移目标出口。commit 在任何写入前校验当前源投影完整覆盖 SOURCE 节点，且 source version、READY、observed version 一致；结构性投影缺链不再永久 `WAITING`，而是以配置损坏进入人工处理。
- smoke 与目标投影 READY 推进改为带原 `phase + status` 的 compare-and-set；远程调用期间发生取消时不会把迁移复活。未 commit 的取消清理从 `NEEDS_OPERATOR` 重试后仍保持 `CANCELLED`，cleanup 完成后也不会误转 `COMPLETED`。
- DELETE `409` 只在 GET 回读得到同 delete version 的精确 `DELETED` 墓碑时视为幂等重放；活动态或其他版本保持 `IDEMPOTENCY_CONFLICT`，由 job runner 立即升级 `NEEDS_OPERATOR`。

### External contract blocker

- OpenUI 会在同一节点全局拒绝重复 client email，新 versioned projection key 因此无法给 retained node 预投影；它也没有原子 staged egress replacement，所有 `EXIT_ONLY` 无法满足“提交前目标投影 READY + smoke”的 PRD 不变量。控制面现于任何 reservation 前明确返回 422（`migration_retained_node_staging_unsupported` / `migration_exit_only_staging_unsupported`）。这不是能力完成；要解除阻断，必须先在 OpenUI 增加并真实验证 staging contract。

### RED / GREEN evidence

- RED: 4 files / 5 failures reproduced OpenUI tombstone rejection, retained/EXIT_ONLY unsafe creation, EXIT_ONLY cancel rollback, and public HTTP smoke startup acceptance.
- RED: 4 files / 8 failures reproduced stale DELETE version, missing cutover route evidence, cross-line/partial/stale-version route imports, and delete-work version mismatch.
- RED: 2 files / 3 failures reproduced stale-worker final writes and projection lease exhaustion retry loop.
- RED: 6 files / 8 failures reproduced NODE_ONLY target-exit rejection, smoke/readiness cancellation races, cancelled-cleanup retry intent loss, missing source projection acceptance/permanent wait, and true DELETE conflict downgrading.
- GREEN: migration/projection/config/route focused suite passed 16 files / 89 tests; additional delete replay, operator retry, and rollback source readiness suite passed 3 files / 21 tests.
- GREEN: second-review focused suite passed 6 files / 39 tests.

### Verification

- API tests: `pnpm --filter @ipeasy/api test` -> 95 files / 557 tests passed, exit 0.
- Worker tests: `pnpm --filter @ipeasy/worker test` -> 6 files / 21 tests passed, exit 0.
- TypeCheck: API and Worker commands both reported `TypeScript: No errors found`, exit 0.
- Lint: API `eslint src` and Worker `eslint src` both exit 0.
- Build: API `nest build` and Worker `tsc` both exit 0.
- Diff hygiene: `git diff --check` -> exit 0.
- Frontend freeze: `git status --short -- apps/web` has no changed path; `apps/web/dist/index.html` SHA256 = `3E1F90AE6132B7859442D692BAECAA303EAC2896E30CE8D04AC2A873230B2386`.
- Production execution remains default-off. No real OpenUI node, NY route, provider purchase, or production smoke was executed in this code-only gate.
- Tool note: an initial parallel quality-gate run completed all Worker assertions but ended non-zero with Tinypool `Failed to terminate worker`; the same Worker suite was rerun serially and passed 6 files / 21 tests with exit 0. Only the serial result is treated as gate evidence.

## 迁移业务审计复核（2026-08-14）

### Findings (fixed)

- 迁移取消、路由导入、smoke observation 与 cleanup 原本完成了领域状态写入，但没有在同一事务中留下业务审计，无法满足迁移全链路可审计要求。现已分别写入 `dedicated_line.migration.cancel`、`dedicated_line.route_import`、`dedicated_line.migration.smoke` 与 `dedicated_line.migration.cleanup`，并记录阶段、结果和关联版本等非敏感元数据。
- 取消迁移原本按 `id` 无条件更新，可能覆盖并发阶段推进。现改为原 `phase + status` compare-and-set；CAS 失败抛出 `migration_cancel_raced`，整笔事务回滚，不保留删除任务或成功审计。
- smoke 在远端调用期间发生并发取消时仍保留观测证据，审计显式记录 `transitionApplied=false`；已存在的有效 smoke 与路由导入回放继续在事务前返回，不产生重复审计。

### RED / GREEN evidence

- RED: 4 focused files -> 4 failed / 19 passed；失败均为迁移取消、路由导入、smoke、cleanup 缺少 audit write。
- GREEN: 4 focused files -> 24 passed；包含取消 CAS 竞争时不写审计的新增回归用例。

### Verification

- API focused tests: 4 files / 24 tests passed, exit 0.
- API TypeCheck: pass, exit 0.
- API Lint: pass, exit 0.
- Final API tests: 95 files / 565 tests passed, exit 0.
- Final Worker tests: 6 files / 21 tests passed, exit 0.
- Final API and Worker TypeCheck, Lint, and Build: all pass, exit 0.
- Frozen install: pnpm 9.15.0 `install --frozen-lockfile --ignore-scripts` pass; production audit reports no known vulnerabilities.
- Web freeze: `apps/web` has no changed path; `apps/web/dist/index.html` SHA256 remains `3E1F90AE6132B7859442D692BAECAA303EAC2896E30CE8D04AC2A873230B2386`.

## 专线 SKU inventorySource CLI/seed 收口（2026-08-14）

### 架构与数据流

- 目标：为默认专线 SKU `SV` / `ZB` 提供真实、显式的 Provider 库存来源配置入口；默认 seed 不猜测 Provider 或资源映射。
- Source of Truth：`service_skus.capabilities.inventorySource` 持有 `{ providerCode, providerResourceIds }`；原生 Provider 集合复用 `provider-ops.validation.ts` 的 `NATIVE_PROVIDER_CODES`，不维护第二份列表。
- 写路径：CLI 参数 -> `sku-inventory-source` 归一化/校验 -> `sku-inventory-source.service` -> Prisma `service_skus`；默认 seed 保留已有合法映射，单 SKU 命令只替换 `inventorySource` 并保留其他 capabilities。
- 明确不做：不修改 `apps/web`，不生成假 Provider 映射，不把 `UPSTREAM_API` 当原生库存源，不执行真实生产数据库写入。

### Findings (fixed)

- 默认 `seed:line-skus` 继续幂等写入 `SV` / `ZB`，新建时不包含 `inventorySource`；只有同时显式提供 `--provider-code` 与至少一个非空 `--provider-resource-ids` 才写映射。
- 新增 `sku:set-inventory-source`，支持对一个专线 SKU 配置独立映射；不同 SKU 需要分别调用，避免 seed 猜测二者供应关系。
- 映射校验拒绝不完整、空数组、空白项、非字符串资源 ID、非原生 Provider 和 `UPSTREAM_API`；资源 ID 去空白并去重，但不静默丢弃空白项。
- 裸 flag（例如只有 `--provider-code` 而无值）也会在 Prisma 查询前以 `inventory_source_incomplete` 失败；已有畸形映射在无显式覆盖的 reseed 中可见失败，不伪装成未配置。
- 业务写入移入 `apps/api/src/modules/catalog/sku-inventory-source.service.ts`，CLI 仅负责编排与退出码，避免 API `rootDir=src` 被脚本实现污染。

### RED / GREEN evidence

- RED: focused spec 首次收集失败，`sku-inventory-source` 模块不存在。
- RED: CLI 独立 `tsc` 首次失败，普通 `Record<string, unknown>` 不能直接写入 Prisma JSON；改为递归收窄到 `Prisma.InputJsonObject`。
- RED: API TypeCheck 首次失败，`src` 测试导入 `scripts` 越过 `rootDir`；写入逻辑迁入 `src` service 后恢复通过。
- GREEN: focused suite `sku-seed.spec.ts`、`sku-inventory-source.spec.ts`、`sku-inventory-source-cli.spec.ts` -> 3 files / 18 tests passed。
- GREEN: 裸 `--provider-code` CLI 探针命中 `inventory_source_incomplete`，内部脚本 exit `2`；未发起数据库连接。

### Verification

- API tests: `pnpm --filter @ipeasy/api exec vitest run --reporter=dot` -> 97 files / 582 tests passed, exit 0.
- API focused tests: 3 files / 18 tests passed, exit 0.
- API TypeCheck: `pnpm --filter @ipeasy/api typecheck` -> `TypeScript: No errors found`, exit 0.
- CLI TypeCheck: 两个 SKU 脚本使用独立严格 `tsc --noEmit` 门验证，exit 0。
- API Lint: `pnpm --filter @ipeasy/api lint` -> `eslint src`, exit 0.
- API Build: `pnpm --filter @ipeasy/api build` -> `nest build`, exit 0.
- 未执行真实 DB seed：没有可核验的生产 `siteId` 和上游同步返回的真实 `providerResourceIds`。操作员必须使用成功库存同步得到的资源 ID 显式配置；未配置时专线库存不会被猜测映射。

## SKU 事务与 CLI 独立复审（2026-08-14）

### Findings (fixed)

- 默认 SKU seed 改为 serializable transaction，整批 `SV` / `ZB` 写入原子提交；保留已有无关 capabilities，不再因 reseed 丢失领域能力。
- 单 SKU 映射更新使用 JSON compare-and-set，拒绝覆盖并发 capability 变更；相同配置按幂等 no-op 处理。
- CLI 拒绝未知、位置、重复和无值参数；畸形持久化映射继续显式失败，不降级成未配置。

### Verification

- Focused catalog suite: 27 tests passed, exit 0.
- Final API tests: 97 files / 592 tests passed, exit 0.
- API/Worker TypeCheck, Lint and Build: pass, exit 0.
- Provider/SKU script strict TypeCheck: pass, exit 0.
- Worker tests: 6 files / 21 tests passed, exit 0.
- Production dependency audit: 337 production dependencies, 0 known vulnerabilities at every severity, exit 0.
- Diff hygiene: `git diff --check` pass; only existing LF/CRLF working-copy warnings.
- Frontend freeze: no `apps/web` changed path; `apps/web/dist/index.html` SHA256 remains `3E1F90AE6132B7859442D692BAECAA303EAC2896E30CE8D04AC2A873230B2386`.

## Railway 生产恢复审计（2026-08-14）

### 真实状态

- `Postgres-CVre` 的卷 `postgres-volume-qG6g` 已使用 `10011.762688 MB / 10000 MB`。重新挂载后的启动日志稳定复现 `could not write to file "pg_wal/xlogtemp.*": No space left on device`，服务最终为 `CRASHED`，没有可接受连接的数据库实例。
- Railway 上已有原生卷备份 `Online resize to 10000MB`（2026-06-25，used 3323 MB / referenced 4992 MB）。未获得创建第二个原生备份的写权限，未删除或覆盖现有备份。
- 只读救援服务完成文件级导出后已删除，其公开域名和临时访问令牌已撤销；原卷已重新挂回 `Postgres-CVre` 的 `/var/lib/postgresql/data`。
- 本地文件级内容备份位于 `C:\Users\Lenovo\Desktop\365-backups\postgres-volume-2026-08-14`，manifest 位于 `C:\Users\Lenovo\Desktop\365-backups\postgres-volume-manifest.json`。逐项校验 `1560 / 1560` 个普通文件，合计 `9,730,640,020` 字节，大小不一致 `0`。失败的中途 tar 已删除，避免被误作可恢复备份。
- 文件级导出用于取证和补充恢复，不替代 Railway 原生快照；未在真实 PostgreSQL 进程上完成恢复演练，也未证明该目录可直接启动。
- 线上旧入口 `https://frontend-test-a8da.up.railway.app` 返回 HTTP 200；冻结前端 artifact 仍直接引用 `https://backend-test-0dcb.up.railway.app`。当前项目的 frontend/backend 公网域名均返回 HTTP 404，Railway 状态分别为 `CRASHED` / `FAILED`，两套部署拓扑不是当前可用的一体化生产栈。

### 生产结论

- 代码质量门通过，但整个平台 **不可投入生产**：数据库无可用实例，frontend/backend/worker 没有健康部署，OpenUI retained-node / `EXIT_ONLY` staging contract 未具备，真实 Provider/OpenUI/NY/Bark 端到端 smoke 未执行。
- 支付确认、Provider 履约和迁移执行开关必须继续保持关闭。恢复顺序应为：扩容或从 Railway 原生备份恢复到新卷 -> 数据完整性/迁移检查 -> backend/worker 部署 -> 冻结前端与 API contract 对齐验证 -> 真实测试 SKU 小额全链路 smoke -> 经人工审批逐项启用执行开关。
- 用户在会话中暴露过基础设施与上游应用凭据；生产恢复前必须全部轮换，并只通过 Railway secret 重新注入。
- 代码工作树中的历史测试 fixture `apps/api/src/common/crypto/aes-gcm.spec.ts` 与 `apps/api/src/modules/providers/tests/adapter-buy-request.spec.ts` 已移除真实 APIKey 前缀和 ZoneID，改为测试占位值；这不清除 Git 历史中的旧提交，因此凭据轮换仍是上线前硬门。
