import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, TestRequest } from '../../../test-utils/integration-setup';
import { setupSwagger } from '../openapi-setup';

let app: NestFastifyApplication;
let request: TestRequest;

beforeAll(async () => {
  app = await createTestApp({ beforeInit: setupSwagger });
  request = supertest(app.getHttpServer());
});

afterAll(async () => {
  await app?.close();
});

describe('OpenAPI setup', () => {
  it('serves the generated document outside the API envelope', async () => {
    const res = await request.get('/openapi.json');

    expect(res.status).toBe(200);
    expect(res.body.code).toBeUndefined();
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.info.title).toBe('IPEasy Platform API');
    expect(res.body.components.securitySchemes.apikey).toEqual({
      type: 'apiKey',
      in: 'header',
      name: 'apikey',
    });
    expect(res.body.components.securitySchemes.bearer).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
    expect(res.body.paths['/api/dedicated-lines/{id}/suspend'].post.responses['201'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/DedicatedLineLifecycleResultDto',
    });
    expect(res.body.paths['/api/dedicated-lines/{id}/resume'].post.responses['201'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/DedicatedLineLifecycleResultDto',
    });
    expect(res.body.components.schemas.DedicatedLineLifecycleResultDto.required).toEqual([
      'lineId',
      'status',
      'desiredVersion',
      'expiresAt',
      'replayed',
    ]);
  });
});
