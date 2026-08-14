# 架构规范：IPIPX 家宽代理平台

## 目标

本项目从零重写一个真实可发布的 985Proxy-compatible OpenAPI 家宽代理平台。平台每一层同时承担两个角色：

- Upstream Consumer：用直接上游 APIKey 采购资源。
- Downstream Provider：用本层 OpenAPI 对外供货。

第一阶段只交付真实工程骨架、权限和资金闭环；代理购买、Provider 履约、资源编排完整工作台放到第二阶段。

## 模块边界

后端模块必须区分：

- Domain：领域类型、不变量、状态机、金额、币种、时间规则。
- Use Case：业务流程、权限校验、事务边界和领域规则编排。
- Repository：数据库读写；不能把 infra error 伪装成业务 not found。
- Adapter：Provider、支付渠道、短信、邮件、对象存储等外部系统。
- Controller：只解析请求、传入认证上下文、调用 use case、返回统一 envelope。

前端模块必须区分：

- Route Shell：页面编排和布局。
- Feature Container：绑定 query、mutation、form。
- Presentational Component：纯展示，尽量没有业务副作用。

## Source of Truth

| 领域 | 权威来源 |
| --- | --- |
| 用户/租户 | PostgreSQL `users / tenants / admin_users` |
| 权限 | 后端 RBAC/Scope guard |
| APIKey | `api_keys` hash + scopes + owner + ip whitelist |
| 资源 | `platform_resources` |
| 库存 | `inventory_snapshots`，必须有 `capturedAt` 和 freshness |
| 映射 | `resource_mappings` |
| 价格 | `user_resource_price_overrides > user_price_bindings/price_templates > price_overrides > default price_rules` |
| 资金 | `payment_orders + wallets + ledger_entries` |
| 币种 | 全局 `platformCurrency`，第一阶段单币种 |
| 订单 | `orders + order_items` |
| 履约 | `fulfillment_jobs / upstream_order_mirrors / proxy_instances` |
| 审计 | `audit_logs` |
| 上游请求 | `upstream_request_logs` |
| 文案 | 前端 i18n locale + 后端稳定 `code/reasonKey` |

## 第一阶段目录边界

推荐骨架：

```txt
apps/
  api/
  web/
  worker/
packages/
  db/
  contracts/
  config/
  eslint-config/
  tsconfig/
prisma/
scripts/
docs/
```

后端推荐目录：

```txt
apps/api/src/
  common/
    config/
    errors/
    logging/
    auth/
    pagination/
    money/
    time/
  modules/
    auth/
    users/
    tenants/
    api-keys/
    wallet/
    payments/
    audit/
    openapi/
```

第二阶段再开启：

```txt
modules/providers/
modules/resources/
modules/pricing/
modules/orders/
modules/fulfillment/
modules/proxies/
integrations/providers/
integrations/payments/
```

## 禁止事项

- 不复制旧项目 `App.tsx`、`styles.css`、单文件大模块。
- 不使用 mock、memory mock DB、假库存、假余额、假订单、假权限。
- 不在生产路径 catch 后返回空数组、默认成功、默认价格、默认余额。
- 不把业务逻辑塞进 React 组件、route handler、ORM model 或配置对象。
- 不手写多套漂移契约；OpenAPI 与前端类型必须走统一生成路径。
