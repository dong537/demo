# Task 13 — 985Proxy-compatible OpenAPI（/res_static/*）

## 目标

实现兼容 985Proxy 风格的公开 API，路由在 `/res_static/*` 下，`apikey` header 鉴权，返回 `code/msg/data` envelope，供 Reseller 分站直接当普通上游使用。

## 接口清单

```
POST /res_static/business       → 静态业务列表（国家/地区/IP类型）
POST /res_static/inventory      → 库存查询
POST /res_static/calculate      → 价格计算（报价）
POST /res_static/buy            → 购买下单
POST /res_static/renew          → 续费
POST /res_static/order_result   → 单笔订单结果
POST /res_static/order_list     → 订单列表
POST /res_static/ip_list        → 已购 IP 列表
POST /res_static/ip_detail      → 单 IP 详情
POST /res_static/change_auth    → 修改代理账密
POST /res_static/switch_ip_list → 可切换 IP 列表
POST /res_static/switch_ip      → 切换 IP
POST /res_static/wallet/balance → 钱包余额
POST /res_static/wallet/records → 账务记录
```

## envelope 格式（985Proxy 兼容）

```ts
// 成功
{ code: 0, msg: "success", data: T }
// 失败
{ code: ErrorCode, msg: string, data: null }
```

注意：此处 `requestId` 不必须对外暴露（985Proxy 兼容模式），但内部日志必须记录。

## res-static.mapper.ts

把内部领域对象映射到 985Proxy 兼容字段名，例如：
- `proxy_instances` → 985Proxy 的 `ip_info` 格式（`ip/port/username/password/protocol/expire_time`）
- `orders` → 985Proxy 的 `order_no/status/create_time`
- `platform_resources` → 985Proxy 的 `area_code/area_name/ip_type/stock`

## 鉴权

`@RequireAuth()` 优先使用 `apikey` header（`ApiKeyStrategy`），也支持 Bearer token。`USER` scope 只能访问自己数据，不能访问 `/system/*`。

## 验证步骤

```bash
pnpm --filter @ipeasy/api typecheck
# 用测试 APIKey：
curl -X POST http://localhost:3000/res_static/business \
  -H "apikey: <test_key>" \
  -H "Content-Type: application/json" \
  -d '{}'
# 期望：{ code: 0, msg: "success", data: [...] }
```

## 禁止

- 不暴露内部 UUID 作为 985Proxy 兼容字段（映射到稳定 order_no 格式）
- 不在此层再做一次权限逻辑（复用已有 Guard）
- 禁止返回空数组冒充无数据（错误用 code !== 0 返回）
