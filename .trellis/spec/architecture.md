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

## 专线迁移生产状态机

- PostgreSQL 的迁移、投影与 `external_jobs` 是权威状态；Worker 只负责物化、租约领取和执行作业，不自行推进领域状态。
- smoke、远端投影删除与 cleanup 必须经 `external_jobs` 执行。作业用条件更新领取租约；超时租约可恢复，同一个作业不能被多个 Worker 同时执行。
- 远端删除使用严格大于本地投影版本的 delete version。DELETE `404` 是幂等成功；DELETE `2xx` 或墓碑重放 `409` 后必须 GET 回读，只有 `404` 或 desired/observed version 都等于 delete version 的 `DELETED` 墓碑才算确认。在确认前不得删除本地投影、释放节点容量或出口。
- commit 只完成切流并把目标投影重新置为待确认状态，专线保持 `PROVISIONING`；只有当前 `desiredVersion` 的全部目标投影回读为 `READY` 后，投影仓储才可把专线推进为 `ACTIVE`。
- 取消 PREPARE/CANARY 迁移时必须先排队删除所有暂存远端投影，再由 cleanup 释放目标节点、出口和本地投影。重试耗尽或不可重试错误必须把迁移置为 `NEEDS_OPERATOR`，不能伪装为空或成功。
- 当前 OpenUI 在同一节点按 client email 做全局唯一性校验，且没有原子 staged egress replacement。控制面必须显式拒绝 retained target node 和 `EXIT_ONLY`；解除限制前需先扩展并验证外部数据面 staging contract，禁止用兼容分支或覆盖当前投影绕过。
- 迁移路由导入必须只包含该迁移所属专线，CANARY/CUTOVER 精确覆盖 TARGET 节点并匹配 target line version，ROLLBACK 精确覆盖仍有 READY source projection 的 SOURCE 节点并匹配 source line version。
- job 的完成、延后和失败都必须使用包含 `LEASED`、owner、desired version 和未过期时间的条件更新。终态错误通过 operator retry 显式重排关联失败作业；ROLLBACK 仍必须先导入人工路由证据。
- 迁移暂存投影的出口来源由迁移类型决定：`NODE_ONLY` 必须使用当前 `ACTIVE` 出口分配，`FULL` 必须使用已保留的目标出口。commit 前必须验证当前源投影与全部 SOURCE 节点一一对应，且 source version、`READY` 与 observed version 完整匹配；缺失关系是配置损坏，不能无限 `WAITING`。
- 任何跨远程调用的迁移推进都必须以读到的 `phase + status` 做 compare-and-set；smoke 或投影回读晚于取消时只保留证据，不得把 `CANCELLED` 复活为 `ACTIVE`。取消清理进入 `NEEDS_OPERATOR` 后重试仍恢复为 `CANCELLED`，直到 cleanup 完成。
- DELETE `409` 仅当随后 GET 得到同 delete version 的精确 `DELETED` 墓碑时可视为幂等重放；读回仍为活动态或其他版本时必须保留冲突并立即升级人工处理，不得转成可重试上游错误。
- smoke 的 verified observation 只有在 `freshUntil` 仍有效且观测国家与专线 `countryCode` 精确匹配时才可推进；过期证据必须重新探测，国家不符只记录失败证据。
- 路由导入重放除 source fingerprint 外，还必须与已持久化 route 的 migration id 和 stage 完全一致；目标投影就绪推进必须覆盖迁移 TARGET 节点的全部 projection link，缺失或重复关系不得推进。
- 迁移取消、路由导入、smoke observation 和 cleanup 完成必须在各自状态写入的同一事务内记录 `audit_logs`；取消状态更新必须使用原 `phase + status` 做 compare-and-set。幂等回放不得重复写审计，smoke 在远端调用期间遭遇并发状态变化时应记录证据及 `transitionApplied=false`，不得伪造推进成功。
