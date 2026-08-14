import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, TestRequest } from '../../test-utils/integration-setup';

let app: NestFastifyApplication;
let request: TestRequest;

beforeAll(async () => {
  app = await createTestApp();
  request = supertest(app.getHttpServer());
});

afterAll(async () => {
  await app?.close();
});

describe('api platform contract', () => {
  it('/health bypasses the API envelope', async () => {
    const res = await request.get('/health');

    expect(res.status).toBe(200);
    expect(res.body.code).toBeUndefined();
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('/ready verifies database and redis connectivity', async () => {
    const res = await request.get('/ready');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks).toEqual({
      db: { ok: true },
      redis: { ok: true },
    });
  });

  it('unknown API routes return the error envelope with requestId', async () => {
    const res = await request.get('/api/does-not-exist').set('x-request-id', 'contract-test-request');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      code: 'NOT_FOUND',
      msg: 'Not found',
      data: { reasonKey: 'not_found' },
      requestId: 'contract-test-request',
    });
  });
});
