# Task 17: Reseller 品牌配置

## 目标
允许 TENANT_ADMIN 配置分站的品牌信息（名称、Logo、主题色、域名等），前端按 tenantId 加载对应品牌配置。

## 实现内容

### Schema
`tenants` 表新增 `brandConfig Json?` 字段（若尚未存在）。

### API 端点
- `GET /api/tenants/:id/brand` — 读取品牌配置（公开，无需认证）
- `PUT /api/tenants/:id/brand` — 更新品牌配置（TENANT_ADMIN 自己，PLATFORM_ADMIN 任意）

### BrandConfig 结构
```ts
{
  siteName: string;
  logoUrl?: string;
  primaryColor?: string;
  customDomain?: string;
  supportEmail?: string;
}
```
