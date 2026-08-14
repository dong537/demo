# Task 04 — OpenAPI 生成 + 前端类型生成管道

## 目标

用 `@nestjs/swagger` 从后端 schema 生成 `openapi.json`，再用 `openapi-typescript` 生成前端类型到 `packages/contracts`，确保前后端契约有唯一来源，禁止手写漂移类型。

## 实现要求

### apps/api/src/modules/openapi/openapi-setup.ts

```ts
export function setupSwagger(app: NestFastifyApplication): void {
  const config = new DocumentBuilder()
    .setTitle('IPEasy Platform API')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'apikey' }, 'apikey')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
  // 同时挂载 /openapi.json（不套 /api prefix）
  app.getHttpAdapter().get('/openapi.json', (_req, reply) => {
    reply.send(document);
  });
}
```

在 `main.ts` 中调用（非生产也调用，方便开发验证）。

### apps/api/scripts/export-openapi.ts

独立脚本，启动最小 NestJS 应用，调用 `setupSwagger`，把 document 写到 `../../packages/contracts/openapi.json`，然后退出。

```bash
# 使用方式
pnpm --filter @ipeasy/api export:openapi
```

### packages/contracts/scripts/generate.sh

```bash
#!/bin/sh
set -e
cd "$(dirname "$0")/.."
npx openapi-typescript openapi.json -o src/generated/api.ts
```

### packages/contracts/src/index.ts

```ts
// 从生成文件 re-export，供前端 import
export type { paths, components, operations } from './generated/api';
```

### packages/contracts/package.json

```json
{
  "name": "@ipeasy/contracts",
  "scripts": {
    "generate": "sh scripts/generate.sh"
  },
  "devDependencies": {
    "openapi-typescript": "^7"
  }
}
```

### turbo.json 更新

在 pipeline 中新增 `export:openapi`（dependsOn `build`，output `../../packages/contracts/openapi.json`）和 `generate`（dependsOn `export:openapi`）。

### DTO 装饰器规范

后续所有 DTO 必须：
- 用 `@ApiProperty()` 标注每个字段（包括 optional）
- 金额字段标注 `type: 'string'`, `pattern: '^[0-9]+(\\.[0-9]+)?$'`
- 枚举字段用 `@ApiProperty({ enum: SomeEnum })`
- 分页响应用泛型 wrapper：`class PageResultDto<T> { items: T[]; total: number; page: number; pageSize: number; }`

## 验证步骤

```bash
pnpm --filter @ipeasy/api build
pnpm --filter @ipeasy/api export:openapi   # packages/contracts/openapi.json 生成
pnpm --filter @ipeasy/contracts generate   # packages/contracts/src/generated/api.ts 生成
pnpm --filter @ipeasy/contracts typecheck  # 无类型错误

# 运行时验证
pnpm --filter @ipeasy/api dev &
curl http://localhost:3000/openapi.json | jq '.info.title'  # "IPEasy Platform API"
```

## 禁止

- 不手写 `packages/contracts/src/generated/api.ts`（必须由脚本生成）
- 不在 DTO 外另写一份 interface 类型（DRY）
- 不把 Provider secret、数据库连接字符串注入 OpenAPI schema
