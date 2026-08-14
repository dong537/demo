# Task 19 — Provider 运营 CLI + 凭据配置工具

## 目标

实现 PRD「Provider 运营命令」要求的 CLI 工具，用于真实 Provider 联调：
- 把真实凭据加密写入 `provider_accounts`（不明文存库）
- health-check：探测上游连通性
- sync-inventory：同步上游库存到 `inventory_snapshots`
- test-buy --dry-run：构造下单请求但不真实扣款/交付

所有命令复用现有 `ProviderRegistryService` 和 adapter，不重写业务逻辑。命令通过独立 ts-node 脚本启动最小 NestJS 上下文运行。

## 凭据加密格式

复用 `apps/api/src/common/crypto/aes-gcm.ts`（已存在，task 12 创建）的 `encryptAesGcm(plaintext, keyHex)`，输出格式 `iv:authTag:ciphertext`（hex），与 `ProviderRegistryService.decryptAesGcm` 对应。

## scripts/provider-credential.ts

把真实凭据加密写入 `provider_accounts`：

```bash
pnpm --filter @ipeasy/api provider:set-credential -- \
  --provider NINE_EIGHT_FIVE \
  --site <siteId> \
  --base-url https://open-api.985proxy.com \
  --status ACTIVE \
  --credential '{"apikey":"REAL_KEY"}'
```

实现：
- 从 `process.argv` 解析参数（或用 `process.env` 接收 credential JSON 避免命令行历史泄露——优先支持 `PROVIDER_CREDENTIAL_JSON` 环境变量）
- 用 `APP_ENCRYPTION_KEY`（从 env）加密 credential JSON
- upsert `provider_accounts`（同 siteId+providerCode 更新，否则创建）
- 输出只打印 providerCode/status/baseUrl，**绝不打印凭据明文或密文**
- credential JSON 的 key 按 provider 类型：
  - IPIPD: `{"appId":"...","appSecret":"..."}`
  - NINE_EIGHT_FIVE: `{"apikey":"..."}` 或 `{"username":"...","password":"..."}`
  - PR: `{"apikey":"..."}` 或 `{"username":"...","password":"..."}`

## scripts/providers-health-check.ts

```bash
pnpm --filter @ipeasy/api providers:health-check -- --provider NINE_EIGHT_FIVE
# 或不带 --provider 检查所有 ACTIVE 的 provider
```

实现：
- 启动最小 NestJS 应用上下文（`NestFactory.createApplicationContext(AppModule)`）
- 取 `ProviderRegistryService`，对指定（或所有 ACTIVE）provider 调 `getConfig` + `adapter.healthCheck`
- 打印结果表：providerCode / healthy / latencyMs / error
- 写 audit log 和 upstream_request_log（healthCheck 已内置日志，确认调用）
- DISABLED 的 provider 显示 `disabled`，不报错
- 退出码：全部健康=0，有失败=1

## scripts/providers-sync-inventory.ts

```bash
pnpm --filter @ipeasy/api providers:sync-inventory -- --provider NINE_EIGHT_FIVE --site <siteId>
```

实现：
- 调 `adapter.syncInventory(config)`
- 把返回的 InventoryItem[] 写入 `platform_resources`（upsert，按 siteId+providerCode+code+ipType）和 `inventory_snapshots`（capturedAt=now）
- 打印同步条数和每个国家的 stock
- inventorySyncEnabled=false 时拒绝执行（提示先启用）
- 上游失败明确报错（UPSTREAM_ERROR/UPSTREAM_TIMEOUT），不写假数据

## scripts/providers-test-buy.ts

```bash
pnpm --filter @ipeasy/api providers:test-buy -- --provider IPIPD --country JP --duration 30 --qty 1 --dry-run
```

实现：
- `--dry-run`（默认 true）：只构造 StaticProxyBuyInput 并打印将发送的请求摘要（脱敏），**不真实调用上游**
- `--no-dry-run` / `--execute`：真实调用 `adapter.buyStaticProxy`，打印 upstreamOrderId 和交付的代理（脱敏 password），写 upstream_request_log 和 audit log
- 真实购买必须二次确认（提示 `--confirm` 标志才执行真实购买）
- 退出码：成功=0，失败=1

## package.json scripts

```json
"provider:set-credential": "ts-node -r tsconfig-paths/register scripts/provider-credential.ts",
"providers:health-check": "ts-node -r tsconfig-paths/register scripts/providers-health-check.ts",
"providers:sync-inventory": "ts-node -r tsconfig-paths/register scripts/providers-sync-inventory.ts",
"providers:test-buy": "ts-node -r tsconfig-paths/register scripts/providers-test-buy.ts"
```

## 验证步骤

```bash
pnpm --filter @ipeasy/api typecheck
# 无凭据时 health-check 应提示 disabled，不崩溃：
pnpm --filter @ipeasy/api providers:health-check
```

## 禁止

- 凭据明文/密文绝不打印到 stdout、日志或错误信息
- test-buy 默认 dry-run，真实购买需显式 --confirm
- 上游失败不写假库存/假代理
- 不绕过 ProviderRegistryService 直接读 process.env 凭据
