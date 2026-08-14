# Task 10 — Provider Adapter（IPIPD / 985Proxy / PR）

## 目标

建立统一的 Provider Registry 配置服务和三个 ProviderAdapter 实现，上游请求/响应脱敏记录到 `upstream_request_logs`，Provider credential 从配置服务读取，禁止 process.env 散落。

## Prisma schema 新增表

在 `packages/db/prisma/schema.prisma` 追加：

**upstream_request_logs**
- `id` UUID PK
- `siteId` String
- `providerCode` String（IPIPD / NINE_EIGHT_FIVE / PR）
- `upstreamAccountId` String nullable
- `operation` String（healthCheck / syncInventory / buyStaticProxy / queryOrder）
- `requestId` String
- `durationMs` Int
- `status` Enum: `SUCCESS | ERROR | TIMEOUT`
- `errorCode` String nullable
- `requestSummary` Json nullable（脱敏后的请求摘要，不含 credential）
- `responseSummary` Json nullable（脱敏后的响应摘要）
- `createdAt` DateTime default now

**provider_accounts**
- `id` UUID PK
- `siteId` String -> sites.id
- `providerCode` String
- `status` Enum: `ACTIVE | DISABLED`
- `credentialEncrypted` String（AES 加密的 JSON，含 appId/appSecret/apikey/username/password）
- `baseUrl` String
- `timeoutMs` Int default 15000
- `inventorySyncEnabled` Boolean default false
- `createdAt` DateTime, `updatedAt` DateTime

## provider.types.ts

```ts
export type ProviderCode = 'IPIPD' | 'NINE_EIGHT_FIVE' | 'PR';
export type UpstreamRequestStatus = 'SUCCESS' | 'ERROR' | 'TIMEOUT';

export interface ProviderHealthResult {
  healthy: boolean;
  latencyMs: number;
  error?: string;
}

export interface InventorySyncResult {
  providerCode: ProviderCode;
  items: InventoryItem[];
  syncedAt: Date;
}

export interface InventoryItem {
  countryCode: string;   // ISO 3166-1 alpha-2
  countryName: string;
  regionCode?: string;
  stock: number;
  ipType: 'NATIVE' | 'BROADCAST';
  protocol: 'HTTP' | 'SOCKS5' | 'BOTH';
  providerResourceId: string;  // 上游内部 ID
}

export interface StaticProxyBuyInput {
  countryCode: string;
  regionCode?: string;
  quantity: number;
  durationDays: number;
  ipType: 'NATIVE' | 'BROADCAST';
  protocol: 'HTTP' | 'SOCKS5' | 'BOTH';
  businessType?: string;
  idempotencyKey: string;
}

export interface ProviderBuyResult {
  upstreamOrderId: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  proxies: ProxyDelivery[];
  failReason?: string;
}

export interface ProxyDelivery {
  ip: string;
  port: number;
  username: string;
  password: string;
  protocol: 'HTTP' | 'SOCKS5';
  expiresAt: Date;
  countryCode: string;
}

export interface ProviderOrderQuery {
  upstreamOrderId: string;
}

export interface ProviderOrderResult {
  upstreamOrderId: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  proxies: ProxyDelivery[];
}

export interface ProviderRuntimeConfig {
  code: ProviderCode;
  status: 'ACTIVE' | 'DISABLED';
  baseUrl: string;
  timeoutMs: number;
  inventorySyncEnabled: boolean;
  credential: Record<string, string>;  // decrypted; never log this
}

export interface ProviderAdapter {
  readonly code: ProviderCode;
  healthCheck(config: ProviderRuntimeConfig): Promise<ProviderHealthResult>;
  syncInventory(config: ProviderRuntimeConfig): Promise<InventorySyncResult>;
  buyStaticProxy(input: StaticProxyBuyInput, config: ProviderRuntimeConfig): Promise<ProviderBuyResult>;
  queryOrder(input: ProviderOrderQuery, config: ProviderRuntimeConfig): Promise<ProviderOrderResult>;
}
```

## provider-registry.service.ts

- `@Injectable()` 单例，注入 `ConfigService` 和 `PrismaClient`
- `getConfig(providerCode: ProviderCode): ProviderRuntimeConfig`
  - 从 `provider_accounts` 读取记录（或 env fallback 供冷启动）
  - 解密 `credentialEncrypted`（AES-256-GCM，key 从 `APP_ENCRYPTION_KEY`）
  - 若 status=DISABLED 或记录不存在，返回 `{ status: 'DISABLED', ... }`
- `getAdapter(code: ProviderCode): ProviderAdapter` — 从注入的 adapter 数组查找
- `logUpstreamRequest(data): Promise<void>` — 写 `upstream_request_logs`，自动脱敏（credential 字段一律替换为 `[REDACTED]`）

## ipipd.adapter.ts

接口文档：`https://api.ipipd.cn`，鉴权 `appId + appSecret`（HMAC-SHA256 签名或直接 header，按真实 API 文档）

实现要求：
- `healthCheck`：GET `/v2/user/balance` 或 ping 端点
- `syncInventory`：GET `/v2/res/list` 或推荐 IP 列表接口，返回 IPIPD 首批覆盖国家（UK/FR/DE/IT/ES/JP/VN/KR/AE/ZA）
- `buyStaticProxy`：POST `/v2/order/buy`，传 countryCode/qty/duration 等参数
- `queryOrder`：GET `/v2/order/detail?orderId=xxx`
- 所有 HTTP 请求通过内部 `fetchWithTimeout(url, opts, timeoutMs)` 发出，超时抛 `AppError(UPSTREAM_TIMEOUT)`
- 上游 HTTP 错误 / 非预期响应抛 `AppError(UPSTREAM_ERROR, reason, 502)`
- 上游库存为 0 抛 `AppError(UPSTREAM_OUT_OF_STOCK)`
- 每次请求后调用 `registry.logUpstreamRequest(...)`

## nine-eight-five.adapter.ts

接口：985Proxy `https://open-api.985proxy.com`，`apikey` header

- `healthCheck`：POST `/res_static/ip_list`（传 pageSize=1）检查连通
- `syncInventory`：POST `/res_static/business` 获取可售业务列表，过滤首批覆盖国家（TW/PH/MY/AU/HK）
- `buyStaticProxy`：POST `/res_static/buy`，payload style 来自 config（`UPSTREAM_985PROXY_STATIC_BUY_PAYLOAD_STYLE`）
- `queryOrder`：POST `/res_static/order_result`

## pr.adapter.ts

PR 供应线（baseUrl 从配置读取），鉴权方式 `username + password` 或 `apikey`

- 实现与 IPIPD 同等完整度的四个方法
- 首批覆盖国家：SG/TH/PL/BR/TR/IL/NL/IN/CA/AT/RO/LV/UA

## SSRF 防护工具（common/utils/ssrf.ts）

```ts
export function assertSafeUrl(url: string): void
// 拒绝：非 https、私网地址（10./172.16-31./192.168./127./::1）、file:// 协议、无协议
// 失败抛 AppError(VALIDATION_ERROR, 'unsafe_upstream_url', 400)
```

所有 adapter 在构造 HTTP 请求前调用此函数校验 baseUrl。

## 验证步骤

```bash
pnpm --filter @ipeasy/api typecheck   # 零错误
# 手动测试（需真实凭据在 .env.local）：
pnpm --filter @ipeasy/api providers:health-check
```

## 禁止

- credential 不进入日志（`logUpstreamRequest` 自动脱敏）
- baseUrl 不硬编码，从 `provider_accounts` 或配置服务读取
- 禁止 `process.env` 散落在 adapter 文件里
- 禁止没有真实上游时返回假数据
