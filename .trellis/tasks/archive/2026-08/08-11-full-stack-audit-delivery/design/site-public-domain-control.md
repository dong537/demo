# 站点公网域名控制契约

## 目标与边界

- 目标：平台管理员可把 Zeabur/自定义公网域名写入站点权威配置，使公开站点解析不再依赖首站点兜底。
- 用户：平台管理员；部署自动化使用 `SYSTEM` 运维入口。
- 成功标准：域名规范化、唯一约束、站点更新与审计同事务，公网 `x-public-host` 精确命中站点。
- 不做：不修改 DNS，不创建 Zeabur 域名，不自动读取部署平台环境变量，不改变租户自定义域名归属。

## Source of Truth 与模块边界

- Source of Truth：PostgreSQL `sites.domain`，全局唯一。
- 校验：共享 DNS hostname validator；站点与租户品牌复用语法规则，各自保留稳定错误语义。
- Use case：验证调用方为 `PLATFORM_ADMIN` 或 `SYSTEM`，在单一事务内更新 `sites` 并写 `audit_logs`。
- API：`PUT /api/sites/current/domain`，由平台管理员 Guard 保护，只编排 use case。
- 运维：受控脚本用 `SYSTEM` context 调用同一 use case；所有参数来自显式环境变量。
- Public read：Web 反代传递 `x-public-host`，`SitesRepository.resolvePublicContext` 按 `sites.domain` 精确读取。

## Interface Contract

请求：

```json
{ "domain": "365proxy.example.com" }
```

- 仅接受 DNS hostname，不接受协议、端口、路径、userinfo、通配符或单标签主机名。
- 输入会 trim 并转小写，最长 253 字符；每个 label 遵循 DNS hostname 规则。
- 域名已被其他站点占用时返回 `VALIDATION_ERROR/site_domain_taken`（HTTP 409）。
- 站点不存在时返回 `NOT_FOUND/site_not_found`（HTTP 404）。
- 成功审计 action 为 `site.domain.update`，meta 记录 previousDomain/newDomain，不记录 secret。

## 数据流与验证

```text
Admin API / SYSTEM ops -> domain validator -> transaction
  -> sites.domain update -> audit_logs create -> response
Public request -> Web x-public-host -> SitesRepository -> exact site/tenant context
```

- 单元测试：合法规范化、非法输入、权限、事务更新、审计、唯一冲突映射。
- 集成测试：平台管理员更新后公开域名精确解析；租户管理员被拒绝。
- 线上 smoke：API/ready、站点更新、`GET /api/sites/current` 返回新 domain，Web/OpenAPI 路径保持可用。
- 回滚：用同一 API/运维命令恢复 previousDomain，产生新的审计记录。
