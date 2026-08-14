# Task 19 架构与数据流记录

## 目标与成功标准

- 提供 Provider 运维 CLI，用于真实上游联调、凭证加密写入、健康检查、库存同步和测试下单。
- 凭证只允许加密入库，不打印明文或密文。
- CLI 必须复用 `ProviderRegistryService`、provider adapter、`SyncInventoryUseCase` 等既有业务模块，不复制上游协议逻辑。
- 成功标准：脚本通过 typecheck/lint/test/build；无凭证或禁用账号时给出明确状态，不写假库存、不做真实购买。

## 不做范围

- 不实现交互式 prompt；真实购买只通过显式 flag 双重确认。
- 不新增 provider 协议能力，adapter 已有能力作为 source of truth。
- 不支持把凭证写到本地文件或日志。
- 不把 CLI 输出接入 OpenAPI/contracts。

## Source of Truth

- `provider_accounts` 是 native provider 凭证、状态、baseUrl、timeout、inventorySyncEnabled 的 source of truth。
- `ProviderRegistryService.getConfig(providerCode, siteId, tenantId?)` 是 CLI 获取运行时配置的唯一入口。
- `ResourcesRepository` / `SyncInventoryUseCase` 是库存写库路径，CLI 不直接复制 `platform_resources + inventory_snapshots + resource_mappings` 写入逻辑。
- adapter 的 `buildBuyRequest()` 是 dry-run 请求预览 source of truth；真实 `buyStaticProxy()` 内部必须复用同一个 request 构造。

## Module 边界

- `apps/api/scripts/_provider-ops.ts`：CLI 专用参数校验、credential 校验、输出脱敏、审计辅助。
- `provider-credential.ts`：读取 operator 输入、校验 credential/baseUrl、加密后 upsert `provider_accounts`。
- `providers-health-check.ts`：启动 Nest context，通过 registry + adapter 执行 healthCheck，展示所有匹配账号状态。
- `providers-sync-inventory.ts`：通过 `SyncInventoryUseCase` 同步库存，读取同步后的资源/库存摘要展示。
- `providers-test-buy.ts`：dry-run 默认；真实购买需要 `--execute` 或 `--no-dry-run` 且同时带 `--confirm`。

## Interface 契约

- `--provider` 只接受 `IPIPD | NINE_EIGHT_FIVE | PR`，不接受 `UPSTREAM_API`。
- `--site` 必填；支持可选 `--tenant` 用于租户级 provider account。
- `provider:set-credential` 优先读取 `PROVIDER_CREDENTIAL_JSON`，其次读取 `--credential`。
- credential 形状：
  - IPIPD: `{ "appId": "...", "appSecret": "..." }`
  - NINE_EIGHT_FIVE / PR: `{ "apikey": "..." }` 或 `{ "username": "...", "password": "..." }`
- `providers:health-check` 未指定 `--provider` 时列出当前 site 下所有 native provider 的最新 site-level/tenant-level账号；禁用账号显示 disabled，不作为失败。
- `providers:sync-inventory` 遇到 disabled 或 `inventorySyncEnabled=false` 直接失败，不写库存。
- `providers:test-buy` dry-run 不需要成功解密凭证；execute 模式必须加载 ACTIVE 配置。

## 风险与验证

- 风险：命令行历史泄漏 credential。默认优先环境变量；所有错误/输出禁止打印 credential 明文或密文。
- 风险：CLI 绕过 adapter/use case 造成请求或库存写入漂移。dry-run 用 `buildBuyRequest`；sync 用 `SyncInventoryUseCase`。
- 风险：真实购买误执行。execute 需要 `--execute`/`--no-dry-run` + `--confirm` 双 flag。
- 验证：新增 CLI helper 单元测试；运行 API typecheck/lint/test/build；脚本在无账号或缺参数时做 smoke。
