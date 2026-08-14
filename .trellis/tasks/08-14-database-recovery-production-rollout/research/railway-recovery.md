# Railway 数据恢复研究记录

## 证据

- 项目：`9cea558e-9db1-4b8e-9bef-21526a2bfad5`，环境：`629d8e6b-37e6-457c-afee-08589f8ca5c0`。
- `Postgres-CVre` 服务当前崩溃，卷约 10GB 且已满；日志为 `FATAL could not write to file "pg_wal/xlogtemp.59": No space left on device`，恢复中断后关闭。
- 旧 `Postgres` 服务卷约 5GB，不能假设其中包含最新业务数据，也不能在未验证容量前导入 9.73GB 物理目录。
- Railway 原生备份 `19efb65e-5d3a-4594-b717-a42c97071897`（2026-06-25，名称 `Online resize to 10000MB`）可见，但当前 OAuth 身份调用 `volumeInstanceBackupList`/恢复相关 GraphQL 操作返回 `Not Authorized`。

## 官方操作边界

- Railway 官方备份恢复接口 `volumeInstanceBackupRestore(volumeInstanceBackupId, volumeInstanceId)` 会创建新卷并保留旧卷，随后需要在控制台审核/部署；不能把恢复误认为原地覆盖。
- 在线扩容需要在 Railway 控制台完成；当前 CLI 只能更新卷名称和挂载路径，不能替代恢复审核。
- 在权限恢复前，任何自动化重试都不会增加证据，不能用猜测的 GraphQL mutation 改写线上卷。

## 结论

1. 先验证本地文件级备份能否启动并逻辑导出；这是当前唯一可自主、可回滚的恢复路径。
2. 若逻辑数据小于新 Railway 卷容量，优先导入全新数据库；若超过容量，必须先扩容/换更大数据库。
3. 旧线上卷在新库验证完成前保持不变；任何切流需记录连接变量变更、healthcheck、回滚目标和时间。

## 2026-08-14 追加验证

- GraphQL introspection 显示 `VolumeCreateInput` 只有 project/environment/service/mountPath/region，`VolumeInstanceUpdateInput` 只有 mountPath/serviceId/state，没有 size 字段。
- `volumeInstanceBackupCreate` 对当前 OAuth 身份返回 `Not Authorized`；因此不能通过当前账号创建第二个 Railway 原生快照。
- 本地恢复后业务库逻辑大小约 8.87GB，逻辑回灌到空库后约 6.85GB；生产卷仍应至少配置 20GB 余量，不能依赖 5GB 默认卷。
