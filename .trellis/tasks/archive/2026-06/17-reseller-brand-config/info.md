# Task 17 架构与数据流记录

## 目标与成功标准

- 允许 TENANT_ADMIN 配置自己租户的品牌信息：站点名、Logo、主题色、自定义域名、客服邮箱。
- 允许 PLATFORM_ADMIN 在当前 site 内管理任意 tenant 的品牌信息。
- 前端可按 tenantId 公开读取品牌配置，用于登录页、门户或 reseller 门面渲染。
- 成功标准：schema 有持久化字段，API 契约生成，权限边界和输入校验有测试覆盖。

## 不做范围

- 不实现域名 DNS 校验、证书签发、域名绑定所有权验证。
- 不改造现有 `sites.brandConfig`；它继续作为平台/site 级品牌来源。
- 不新增图片上传或文件存储能力；`logoUrl` 只保存外部 HTTPS URL。
- 不做旧 schema 兼容和自动迁移兜底。

## Source of Truth

- 租户品牌配置的权威来源是 `tenants.brandConfig`。
- `brandConfig.siteName` 是租户对外展示名称；当 `brandConfig` 不存在时，公开读取返回 `tenant.name` 作为真实租户名称来源。
- `logoUrl`、`primaryColor`、`customDomain`、`supportEmail` 均为租户品牌配置的一部分，没有配置时不返回假默认值。
- 更新路径只允许 `PUT /api/tenants/:id/brand` 写入，并通过 Prisma migration 增加字段。

## Module 边界

- `TenantsRepository` 负责 tenant 品牌配置的 DB 查询、站点范围过滤和返回投影。
- `TenantBrandController` 负责 HTTP contract、权限判定、输入校验、审计记录。
- Prisma schema/migration 负责持久化结构。
- OpenAPI/contracts 由 API DTO 生成，不手写 contract。

## Interface 契约

- `GET /api/tenants/:id/brand`：
  - 公开接口，不需要认证。
  - 只返回品牌公开字段和 tenant 标识，不返回用户、管理员、凭证或其它敏感信息。
  - tenant 不存在返回 `NOT_FOUND / tenant_not_found`。
- `PUT /api/tenants/:id/brand`：
  - 需要认证。
  - TENANT_ADMIN 只能更新自己的 tenant。
  - PLATFORM_ADMIN 只能更新当前 `ctx.siteId` 下的 tenant。
  - 写入完整品牌配置，`siteName` 必填且非空；可选字段可省略或传 `null` 清除。
  - 成功后写 `tenant.brand.update` audit log。

## 输入校验

- `siteName`：trim 后 1..80 字符。
- `logoUrl`：可选；必须是 HTTPS URL，长度不超过 2048。
- `primaryColor`：可选；必须是 `#RRGGBB`。
- `customDomain`：可选；只接受 hostname，不接受协议、路径或端口；长度不超过 253。
- `supportEmail`：可选；基础邮箱格式校验，长度不超过 254。

## 风险与验证

- 风险：公开 GET 泄漏租户存在性。当前 PRD 明确要求公开按 tenantId 读取；接口只返回品牌公开字段。
- 风险：TENANT_ADMIN 越权修改其它 tenant。测试覆盖同 site 跨租户 403。
- 风险：PLATFORM_ADMIN 修改其它 site tenant。测试覆盖跨 site 404。
- 验证：Prisma generate、API typecheck/lint/test/build、OpenAPI export、contracts generate/typecheck、git diff --check。
