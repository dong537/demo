# Task 16: Reseller 上游 API Key 管理

## 目标
允许 TENANT_ADMIN 管理自己分站使用的上游代理提供商 API Key，实现每个 Reseller 独立的上游账号隔离。

## 实现内容

### Schema 变更
`provider_accounts` 表新增 `tenantId` 可选字段，支持 tenant 级别覆盖。

### API 端点
- `GET /api/tenants/:id/provider-accounts` — 列出该租户的上游账号
- `POST /api/tenants/:id/provider-accounts` — 创建上游账号（TENANT_ADMIN 自己，PLATFORM_ADMIN 任意）
- `PUT /api/tenants/:id/provider-accounts/:accountId` — 更新凭证
- `DELETE /api/tenants/:id/provider-accounts/:accountId` — 删除

### 业务逻辑
订单履行时，优先使用 tenant 级别的 provider_account，回退到 site 全局账号。
