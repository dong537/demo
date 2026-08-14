# 上游账号切换与资源实时性修复记录

## 结论

- 上游账号、资源、库存快照、资源映射、报价、履约必须共享 `upstreamAccountId` 这一身份维度。
- 用户端资源列表、国家列表、管理端快速定价目录、定价矩阵不能只看资源 `ACTIVE/isSaleable`，还必须只读取当前有效上游账号返回的资源。
- 通用上游账号保存 URL/API Key 或关闭同步后，旧资源必须立即隐藏；后续只有真实库存同步成功后才重新开放。
- 通用上游 URL 需要去掉尾部 `/res_static`、query 和 hash，避免 adapter 再拼接 `/res_static/ip_list` 造成联通测试失败。
- 已交付代理的续费、改密、换 IP 必须使用代理绑定的 `upstreamAccountId`，不能漂移到后台最新账号。

## 已验证

- 账号维度资源同步、报价、履约、资源列表、定价矩阵、通用上游账号、代理生命周期定点测试通过。
- `@ipeasy/api` typecheck 和 lint 通过。

## Follow-up fixes 2026-06-26

- `providers:sync-inventory` now accepts optional `--account-id` and passes it to `SyncInventoryUseCase`, so operators can verify a just-switched native provider account without relying on current-account ordering.
- `provider-bootstrap` records the provider account id returned by credential upsert and syncs that exact account during bootstrap.
- `ProvidersRepository.listInventorySyncEnabled()` now returns only the latest account per `(siteId, tenantId, providerCode)` when it is both `ACTIVE` and `inventorySyncEnabled`.
- Row-level resource sync tests now assert that `resource.upstreamAccountId` is passed into `SyncInventoryUseCase`.

## Verification 2026-06-26

- `rtk pnpm --filter @ipeasy/api test -- src/modules/resources/resources.controller.spec.ts src/modules/providers/providers.repository.spec.ts src/modules/providers/provider-registry.service.spec.ts src/modules/providers/tests/provider-ops-validation.spec.ts src/modules/providers/tests/provider-country-coverage.spec.ts src/modules/resources/use-cases/sync-inventory.use-case.spec.ts --reporter=dot`
- `rtk pnpm --filter @ipeasy/api test -- src/modules/pricing/use-cases/quote.use-case.spec.ts src/modules/pricing/pricing.repository.spec.ts src/modules/resources/resources.repository.spec.ts src/modules/fulfillment/use-cases/fulfill-static-proxy.use-case.spec.ts src/modules/proxies/proxy-lifecycle.service.spec.ts src/modules/upstream-accounts/upstream-accounts.controller.spec.ts --reporter=dot`
- `rtk pnpm --filter @ipeasy/api typecheck`
- `node apps\api\node_modules\typescript\bin\tsc --noEmit --skipLibCheck --experimentalDecorators --emitDecoratorMetadata --module commonjs --target es2022 --moduleResolution node --esModuleInterop apps\api\scripts\providers-sync-inventory.ts apps\api\scripts\provider-bootstrap.ts`
- `rtk pnpm --filter @ipeasy/api lint`

## Verification 2026-06-26 PM

- Live IPIPD sandbox account probe against `https://api.sandbox.ipipd.cn/openapi/v2/account` returned HTTP 200 with `code=SUCCESS`.
- Live IPIPD sandbox inventory probe against `https://api.sandbox.ipipd.cn/openapi/v2/static/lines` returned HTTP 200 with `code=SUCCESS`, `total=94`, and record fields including `active`, `businessTypeCode`, `cidrs`, `cityCode`, `countryCode`, `currency`, `id`, `price`, `quantity`, `status`, and `tag`.
- `rtk pnpm --filter @ipeasy/api test -- src/modules/providers/tests/provider-country-coverage.spec.ts src/modules/providers/tests/provider-ops-validation.spec.ts src/modules/providers/use-cases/admin-providers.use-case.spec.ts src/modules/tenants/tenant-provider-accounts.controller.spec.ts src/modules/resources/resources.repository.spec.ts src/modules/resources/resources.controller.spec.ts src/modules/resources/use-cases/sync-inventory.use-case.spec.ts --reporter=dot` passed: 84 tests.
- `rtk pnpm --filter @ipeasy/web test -- src/features/admin-providers/tests/provider-health.spec.tsx src/features/admin-tenants/tests/tenant-provider-accounts.spec.tsx --reporter=dot` passed: 32 tests. Existing React `act(...)` warnings remain in the provider-health tests.
- `rtk pnpm --filter @ipeasy/api typecheck` passed.
- `rtk pnpm --filter @ipeasy/api exec tsc --noEmit --target ES2022 --module CommonJS --moduleResolution node --strict --skipLibCheck --esModuleInterop --experimentalDecorators --emitDecoratorMetadata --strictPropertyInitialization false --types node scripts/provider-credential.ts scripts/providers-health-check.ts scripts/providers-sync-inventory.ts scripts/providers-test-buy.ts scripts/provider-bootstrap.ts scripts/replay-provider-country-selection.ts` passed from `apps/api`.
- `rtk pnpm --filter @ipeasy/api build` passed.
- `rtk pnpm --filter @ipeasy/web typecheck` passed.
- `rtk pnpm --filter @ipeasy/web lint` passed.
- `rtk pnpm --filter @ipeasy/worker test -- inventory-sync-worker --reporter=dot` passed: 5 tests.
- `rtk pnpm --filter @ipeasy/worker typecheck` passed.
- `rtk pnpm --filter @ipeasy/api lint` passed.
