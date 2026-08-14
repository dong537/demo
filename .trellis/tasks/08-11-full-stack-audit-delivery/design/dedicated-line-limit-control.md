# 专线客户级限制控制契约

## 目标与边界

- 目标：平台管理员或代理管理员可按客户专线设置流量、上下行速率、最大连接数和 IP 数限制，并通过现有 OpenUI 投影应用到 `inboundTag + clientEmail` 身份。
- 成功标准：权限按 site/tenant 隔离；限制更新、desired version、投影任务与审计同事务；重复提交不创建新版本。
- 不做：不允许终端用户自行提高额度；不实现付费流量扩容。付费扩容必须先建立可报价的流量包/速率档位 SKU 与订单快照。

## Source of Truth 与数据流

- Source of Truth：`dedicated_lines.quotaBytes/uplinkLimitBps/downlinkLimitBps/maxConnections/ipLimit`。
- 单位：`trafficLimitBytes` 为 bytes；两个 `*LimitBps` 字段按 OpenUI 既有实现为 bytes/second；`0` 表示不限。
- API：`PUT /api/admin/control-plane/lines/:id/limits`，完整替换五项限制并要求 `reason`。
- 权限：`PLATFORM_ADMIN` 可管理站点内专线；`TENANT_ADMIN` 只能管理 `ctx.tenantId` 内专线；其他身份拒绝。
- 投影：限制变化 -> `desiredVersion + 1` -> 重新计算 desired hash -> 所有 node projection 置为 PENDING -> 每节点幂等 external job。
- 审计：`dedicated_line.limits.update`，保存 previous/new 限制、reason 和 desiredVersion；不记录凭据。

## Interface Contract

```json
{
  "trafficLimitBytes": 0,
  "uplinkLimitBps": 131072,
  "downlinkLimitBps": 524288,
  "maxConnections": 32,
  "ipLimit": 2,
  "reason": "客户套餐限速"
}
```

- 五个限制字段必须全部提供，均为非负整数。
- BigInt 投影字段不得超过 `Number.MAX_SAFE_INTEGER`；Prisma Int 字段不得超过 `2147483647`。
- 支持 `PROVISIONING/ACTIVE/DEGRADED/SUSPENDED/MIGRATING_AWAITING_ROUTE_IMPORT`；终止或未就绪状态拒绝。
- 重复提交与当前有效值相同则返回 `replayed=true`，不增加版本、不创建任务、不重复审计。

### 读取契约

- 管理端 `GET /api/admin/control-plane/lines` 使用平台统一分页 envelope：`{ page, pageSize, total, items }`，默认且最大页大小为 20。
- `trafficLimitBytes/uplinkLimitBps/downlinkLimitBps` 在读取接口中使用十进制字符串，避免 PostgreSQL `BigInt` 转成 JavaScript `number` 时静默丢失精度。
- 管理端只允许编辑 `Number.MAX_SAFE_INTEGER` 范围内的三项 BigInt 限制；遇到历史越界数据必须显式报错，不能舍入后覆盖。
- 客户端只读展示流量、上下行、连接数和 IP 数限制；客户不能通过该界面提高额度。终止态专线的编辑入口禁用。

## 验证

- 单元：输入边界、管理员权限、租户隔离、幂等、终止态、事务写入、投影任务、审计。
- 集成：真实 PostgreSQL 下限制更新后 DB 字段、desired hash、external jobs 与 audit 一致。
- OpenUI：既有 managed projection 测试验证五项限制写入 client；线上协议吞吐仍需真实专线完成后单独验收。
