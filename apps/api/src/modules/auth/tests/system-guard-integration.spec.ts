import { Controller, Get, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../../../app.module';
import { RequireSystem } from '../../../common/auth/guards';
import { EnvelopeInterceptor } from '../../../common/interceptors/envelope.interceptor';
import { AppExceptionFilter } from '../../../common/errors/exception-filter';
import { configureGlobalPrefix } from '../../../common/http/res-static-compat';
import {
  cleanDatabase,
  seedApiKey,
  seedSite,
  seedTenant,
  seedUser,
  TestRequest,
} from '../../../test-utils/integration-setup';

@Controller('system/probe')
class SystemProbeController {
  @Get()
  @RequireSystem()
  probe(): { ok: boolean } {
    return { ok: true };
  }
}

@Module({ controllers: [SystemProbeController] })
class SystemProbeModule {}

let app: NestFastifyApplication;
let request: TestRequest;
let siteId: string;
let tenantId: string;
let userId: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, SystemProbeModule],
  }).compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  configureGlobalPrefix(app);
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  app.useGlobalFilters(new AppExceptionFilter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  request = supertest(app.getHttpServer());
});

afterAll(async () => {
  await cleanDatabase();
  await app?.close();
});

beforeEach(async () => {
  await cleanDatabase();
  siteId = await seedSite();
  tenantId = await seedTenant(siteId);
  ({ userId } = await seedUser(siteId, tenantId, {
    email: 'system-scope-user@example.com',
    password: 'pw-12345',
  }));
});

describe('system guard integration', () => {
  it('USER with system:* API key scope still cannot access system routes', async () => {
    const { plainKey } = await seedApiKey({
      siteId,
      tenantId,
      ownerId: userId,
      ownerType: 'USER',
      scopes: ['system:*'],
    });

    const res = await request.get('/api/system/probe').set('apikey', plainKey);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PERMISSION_DENIED');
    expect(res.body.data.reasonKey).toBe('insufficient_permissions');
  });

  it('apikey IP whitelist mismatch returns PERMISSION_DENIED before protected handler runs', async () => {
    const { plainKey } = await seedApiKey({
      siteId,
      tenantId,
      ownerId: userId,
      ownerType: 'USER',
      scopes: ['wallet:read'],
      ipWhitelist: ['203.0.113.10'],
    });

    const res = await request.get('/api/system/probe').set('apikey', plainKey);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PERMISSION_DENIED');
    expect(res.body.data.reasonKey).toBe('ip_not_whitelisted');
  });
});
