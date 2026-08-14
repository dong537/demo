# 365Proxy 专线平台生产整改设计

## 目标与成功标准

目标是把当前“代码与基础服务健康”的 Zeabur 环境收敛为可审计、可回滚、可灰度、可真实交付的专线生产系统。

成功必须同时满足：

- 五月版前端制品和既有页面保持冻结，不做视觉、交互或信息架构修改。
- 专线订单在本地有效库存不足时不会创建供应商采购请求，并产生幂等 Bark 告警。
- 有效库存充足时，订单只通过白名单 Provider/账号执行，随后投影到订单固定分配的 3x-ui/OpenUI 节点。
- 每条线路至少有主、备两个入口域名；NY 转发只通过版本化快照导入，不由平台写入。
- 生产源码、数据库 migration、容器镜像和 Git commit 可一一追溯并可以回滚应用版本。
- 真实灰度账号完成报价、支付、库存预留、供应商采购、节点投影、协议握手、交付、续费、迁移和停用。
- 已泄漏凭据全部轮换，仓库和 Git 历史不再包含真实 secret，运行时依赖没有 critical/high 已知漏洞。

## 明确不做

- 不修改 `apps/web` 下的五月版页面、样式、交互和文案。
- 不把家宽/静态住宅产品恢复为可售商品。
- 不用测试价格、假库存、默认节点、默认域名或 Mock 供应商冒充生产配置。
- 不在灰度验证前打开全局真实采购、支付、投影或 Bark 开关。
- 不直接写 NY 面板配置，不修改 Xray core。

## Source of Truth 与数据流

| 领域 | Source of Truth | 写入路径 | 生产准入证据 |
| --- | --- | --- | --- |
| SKU 与售价 | PostgreSQL `service_skus` / price rules | 管理员定价 use case | SV/ZB 都有有效价格规则 |
| Provider 与凭据 | PostgreSQL provider account + Zeabur secret | credential service -> Provider Adapter | 白名单账号健康检查成功 |
| 专线库存 | 有 freshness 的 inventory snapshot | inventory worker -> PostgreSQL | SK5 快照未过期且可用量大于零 |
| 订单和余额 | PostgreSQL order/wallet/ledger | 事务内 use case | 幂等扣款、失败补偿、审计记录 |
| 节点与投影 | PostgreSQL desired/observed projection | worker -> OpenUI Adapter | 指定节点 observed version 收敛 |
| NY 转发 | NY 面板为权威；平台保存导入快照 | 管理员显式导入 | source version、目标端口、主备域名一致 |
| DNS | DNS Provider | 平台外配置 | 外部解析和端口探测通过 |
| 凭据 | Zeabur secret store | 运维注入 | 仓库无明文，轮换记录可审计 |
| 发布版本 | Git commit + image digest | CI build/deploy | 部署元数据可追溯到 commit |

下单数据流保持：

```text
报价 -> 余额/价格事务校验 -> 条件库存预留 -> 订单与 outbox
  -> 白名单 Provider 采购 -> 固定节点放置 -> OpenUI desired projection
  -> observed version 收敛 -> NY 路由快照与主备域名校验
  -> 客户交付 -> 外部协议握手与出口国家验证
```

库存条件更新与订单/outbox 在同一数据库事务中完成。库存不足分支只写告警 outbox，不生成采购 job，因此供应商 Adapter 没有可执行输入。

## Module 边界

- `common/config`：只拥有启动配置类型与 fail-closed 门禁。
- `modules/health`：`/health` 和 `/ready` 只表示进程、PostgreSQL、Redis 可用，不承诺业务可售。
- 新的生产准入 Module：只读聚合价格、Provider、库存、节点、路由、域名和执行开关，返回逐项状态；不得产生订单或修改业务数据。
- `dedicated-line-orders`：拥有库存预留、订单、采购 job 与缺货告警的原子事务。
- `dedicated-line-projections`：拥有 OpenUI desired/observed 收敛，不决定订单价格或库存。
- `worker`：按显式开关和白名单执行，不从默认值推断生产权限。
- `scripts` / CI：拥有 secret scan、依赖审计、质量门和发布元数据校验。

## Interface 契约

生产 OpenAPI：

- `NODE_ENV=production` 时默认不注册 `/api/docs` 和 `/openapi.json`。
- 只有显式 `OPENAPI_EXPOSURE_ENABLED=true` 才可注册，并由部署门禁拒绝误配置。
- 测试和离线 contract 导出继续调用 `setupSwagger()`，不依赖公网暴露。

业务生产准入：

- 管理员受保护接口返回 `{ ready, checks, checkedAt }`。
- 每个 check 包含稳定 `key`、`ok` 和非敏感 `reasonKey`，不得返回凭据、连接密钥或 Provider 原始响应。
- 任一必需项失败时 `ready=false`；它不改变 `/ready` 的负载均衡语义。

发布质量门：

- secret scan、生产依赖 audit、typecheck、lint、API/worker tests、真实 DB integration、build 和 Playwright E2E 必须全部成功。
- 前端只验证冻结制品和既有行为，不修改页面源码。
- 发布只允许 clean Git tree，镜像必须带 commit SHA/digest。

## 错误与安全

- Secret scan 命中时退出非零并只报告文件/规则，不打印完整 secret。
- Provider、OpenUI、Bark 或线路探测失败必须保留稳定错误分类和 request ID，不转为空数据。
- `/ready` 不主动探测第三方，避免上游抖动导致 API 全部摘流；生产准入接口和监控任务负责业务依赖。
- 所有已在聊天、测试文件或部署导出中出现的凭据都按泄漏处理并轮换。
- Git 历史清理是独立、可审计操作；在远程仓库就绪后冻结写入并通知所有协作者重新同步。

## 分阶段发布与回滚

1. 代码安全阶段：执行开关保持关闭；完成 secret、依赖、OpenAPI、生产准入、CI、测试和备份脚本。
2. 配置阶段：只写价格、Provider、库存、节点、域名和 NY 快照；生产准入接口必须列出全部通过证据。
3. 灰度阶段：只放行一个测试用户、一个 Provider 账号、一个 SKU 和有限金额/数量；逐个打开库存、Bark、订单、投影和支付开关。
4. 扩大阶段：灰度完成后按 SKU/客户批次增加 allowlist，不一次性全开。

任何阶段异常时先关闭执行开关和 allowlist；应用回滚到已知 image digest，数据库使用 forward-only corrective migration，不删除订单、账本、outbox 或审计记录。

## 验证矩阵

- 缺货：库存为零/过期/并发耗尽 -> 订单不采购、Bark outbox 恰好一条、可重放不重复。
- 采购：白名单命中 -> 真实测试订单只采购一次；超时和重复 worker claim 不重复采购。
- 投影：固定节点 desired version -> OpenUI observed version；部分节点失败不进入 ACTIVE。
- 线路：主备域名解析、入口端口、VLESS/VMess 实际握手、出口国家、持续流量和限速。
- 生命周期：续费、暂停/恢复、迁移、停用、失败回滚与审计。
- 运维：数据库备份可恢复到隔离实例；监控能发现 worker 停止、库存过期、节点不可达和 outbox 堆积。

