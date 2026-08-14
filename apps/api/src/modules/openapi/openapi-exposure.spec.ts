import { afterEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import supertest from 'supertest';
import { setupSwaggerForEnvironment } from './openapi-setup';

async function createOpenApiTestApp(options: {
  nodeEnv: 'development' | 'test' | 'production';
  exposureEnabled: boolean;
}): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({}).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  setupSwaggerForEnvironment(app, options);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

let app: NestFastifyApplication | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('OpenAPI exposure', () => {
  it('does not expose documentation in production by default', async () => {
    app = await createOpenApiTestApp({ nodeEnv: 'production', exposureEnabled: false });
    const request = supertest(app.getHttpServer());

    expect((await request.get('/openapi.json')).status).toBe(404);
    expect((await request.get('/api/docs')).status).toBe(404);
  });

  it('exposes documentation in production only when explicitly enabled', async () => {
    app = await createOpenApiTestApp({ nodeEnv: 'production', exposureEnabled: true });
    const response = await supertest(app.getHttpServer()).get('/openapi.json');

    expect(response.status).toBe(200);
    expect(response.body.openapi).toMatch(/^3\./);
  });

  it('keeps documentation available outside production', async () => {
    app = await createOpenApiTestApp({ nodeEnv: 'development', exposureEnabled: false });
    const response = await supertest(app.getHttpServer()).get('/openapi.json');

    expect(response.status).toBe(200);
  });
});
