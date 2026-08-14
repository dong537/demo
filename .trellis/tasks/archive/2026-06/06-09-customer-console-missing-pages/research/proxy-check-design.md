# Research: 代理验证工具（proxy-check）选型与 SSRF 边界

- **里程碑**: 3（代理验证工具，全栈）
- **范围**: 单条代理连通性检测。不做批量、不做定时探测、不做地理位置/延迟图表（PRD「明确不做」）。
- **Date**: 2026-06-09

## 1. 探测方案选型

### 现有依赖盘点（apps/api/package.json + node_modules）
- 出站 HTTP 走原生 `fetch`（undici）：`apps/api/src/modules/providers/provider-http.ts:8` `fetchWithTimeout`。
- 原生 `fetch` 不支持「通过代理发请求」（undici 的 `ProxyAgent` 只支持 HTTP 代理，不支持 SOCKS5）。
- 传递依赖里已有 `https-proxy-agent@7.0.6` / `http-proxy-agent@7.0.2` / `agent-base@7.1.4`，但**没有** SOCKS5 能力。
- proxy_instances 协议枚举（`packages/db/prisma/schema.prisma:539`）：`HTTP | SOCKS5`，两种都要支持。

### 选定方案
用 Node 核心 `https` 模块 + 成熟 agent 库，按协议挑 agent，不自造裸 socket 协议握手：

| 协议 | agent 库 | 版本（pinned） | 理由 |
|---|---|---|---|
| HTTP | `https-proxy-agent` | `7.0.6` | TooTallNate 维护，事实标准，已在依赖树中；HTTPS 探测目标走 CONNECT 隧道 |
| SOCKS5 | `socks-proxy-agent` | `8.0.5` | 同作者生态，依赖 `socks@2.8.9` + `agent-base@^7`，与 https-proxy-agent 同源不冲突 |

两者都实现 `agent-base` 的 `Agent` 接口，直接作为 `https.request({ agent })` 传入，统一代码路径。已 `pnpm --filter @ipeasy/api add socks-proxy-agent@8.0.5 https-proxy-agent@7.0.6` 固定到 dependencies。

不选 `proxy-agent`（按 URL 自动选 agent）：它会拉入一堆我们不需要的 agent（pac、socks4 等），surface 更大；显式两库更可控。

### 探测目标与超时
- 固定探测目标 URL：默认 `https://api.ipify.org/?format=json`（返回 `{"ip":"<出口IP>"}`，稳定、轻量、HTTPS）。
- 通过 env `PROXY_CHECK_TARGET_URL` 可覆盖（运维可换成自有出口 IP 端点），默认值写在 env.schema，不硬编码散落业务代码。
- 超时 env `PROXY_CHECK_TIMEOUT_MS`，默认 `8000`（8s）。单次请求，无重试，避免探测风暴。
- 成功判定：拿到 HTTP 响应（任意 2xx/3xx 即视为隧道可用），解析 body 里的出口 IP（解析失败不致命，exitIp 省略，仍 reachable=true）。

## 2. SSRF 边界（关键）

- 端点形状：`POST /api/proxy-check` body `{ proxyId }`。**只接受 proxyId，不接受裸 host/port/protocol。**
- 后端用 proxyId 查 `proxy_instances`，校验归属：`proxy.userId === ctx.ownerId && proxy.tenantId === ctx.tenantId && proxy.siteId === ctx.siteId`，任一不符 → `NOT_FOUND / proxy_not_found`（不泄露存在性）。
- 真实连接信息（ip/port/protocol/username/password）全部来自 DB 该行；password 是 AES-256-GCM 存储，解密只在 use-case 边界（`decryptAesGcm`，参照 proxies.controller 的 `toDeliveryDto`）。客户端永远不传连接信息。
- 因此**出站目标永远是固定探测 URL，代理出口永远是用户自己名下的代理**，不存在「任意目标探测 / 任意代理探测」的 SSRF 面。
- 明确不做裸 host/port 模式：PRD 虽提到「二选一」，但裸 host/port 需要强校验（禁内网段、禁 metadata、禁 localhost…）才能防 SSRF，本里程碑不引入该复杂度与风险，只做 proxyId 模式。

## 3. 错误与超时矩阵

探测失败是**正常业务结果**（reachable=false + error），不是 500：

| 场景 | reachable | error.code | error.reasonKey | HTTP |
|---|---|---|---|---|
| 隧道建立、拿到响应 | true | — | — | 200 |
| 连接被拒 / DNS 失败 / 代理拒绝 | false | PROXY_UNREACHABLE | proxy_unreachable | 200 |
| 超时（>timeout） | false | PROXY_TIMEOUT | proxy_check_timeout | 200 |
| proxyId 不存在 / 非自己 | — | — | — | 404 AppError NOT_FOUND/proxy_not_found |
| 缺 proxyId | — | — | — | 400 AppError VALIDATION_ERROR/proxy_id_required |
| 非 USER / 无 tenant | — | — | — | 403 AppError PERMISSION_DENIED |

只有归属/权限/参数问题抛 AppError；网络层失败一律收敛成 `{ reachable:false, error }`。

## 4. 并发 / 资源边界

- 单次请求 = 单次探测，无内部并发、无重试。
- `AbortController` + `setTimeout` 强制超时并 `req.destroy()`，避免句柄泄漏。
- 不做批量端点（PRD 明确不做），所以无 N 路并发问题。
- 不缓存结果（实时探测才有意义）。

## 5. 敏感信息处理

- 响应 DTO 只含 `{ reachable, latencyMs?, exitIp?, error? }`，**不回显** 代理 ip/port/username/password。
- audit_logs（`action: 'proxy.check'`）meta 只记 `proxyId / reachable / latencyMs / protocol`，**不记** 凭据。
- 日志不打印解密后的 password / 代理 URL。

## 6. 模块落点

新建 `apps/api/src/modules/proxy-check/`（独立模块，按 directory-structure 的模块化风格；proxies 模块已较重，检测是独立能力）：
- `proxy-check.controller.ts` — `POST /api/proxy-check`，`@RequireAuth`。
- `dto.ts` — `CheckProxyDto` / `ProxyCheckResultDto`。
- `proxy-prober.ts` — `ProxyProber` 接口 + `HttpProxyProber` 实现（agent 选择 + https 请求 + 超时）。这是 seam：use-case 注入 prober，单测用假 prober 模拟网络层。
- `use-cases/check-proxy.use-case.ts` — 归属校验 + 解密 + 调 prober + 审计 + 映射。
- `proxy-check.module.ts` — 复用 `ProxiesModule` 导出的 `ProxiesRepository`。
