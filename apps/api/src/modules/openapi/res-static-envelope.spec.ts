import { Controller, Get, HttpCode, Module, Post } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { AppExceptionFilter } from '../../common/errors/exception-filter';
import { configureGlobalPrefix } from '../../common/http/res-static-compat';
import { EnvelopeInterceptor } from '../../common/interceptors/envelope.interceptor';

@Controller('res_static')
class ResStaticProbeController {
  @Post('business')
  @HttpCode(200)
  business(): { ok: boolean } {
    return { ok: true };
  }

  @Post('inventory')
  @HttpCode(200)
  inventory(): never {
    throw new AppError(ErrorCode.UPSTREAM_ERROR, 'inventory_stale', 422);
  }

  @Post('buy')
  @HttpCode(200)
  buy(): never {
    throw new AppError(ErrorCode.PRODUCT_DISABLED, 'static_proxy_purchase_disabled', 410);
  }
}

@Controller('orders')
class ApiProbeController {
  @Get()
  list(): { ok: boolean } {
    return { ok: true };
  }
}

@Controller('v1/settings')
class LegacyApiV1ProbeController {
  @Get('capabilities')
  capabilities(): { dedicatedUiEnabled: boolean } {
    return { dedicatedUiEnabled: true };
  }

  @Get('failure')
  failure(): never {
    throw new AppError(ErrorCode.UPSTREAM_OUT_OF_STOCK, 'dedicated_line_inventory_unavailable', 422);
  }
}

@Module({ controllers: [ResStaticProbeController, ApiProbeController, LegacyApiV1ProbeController] })
class ProbeModule {}

let app: NestFastifyApplication;
let request: ReturnType<typeof supertest>;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  configureGlobalPrefix(app);
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  app.useGlobalFilters(new AppExceptionFilter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  request = supertest(app.getHttpServer());
});

afterAll(async () => {
  await app?.close();
});

describe('res_static envelope compatibility', () => {
  it('serves res_static routes without /api and without requestId', async () => {
    const res = await request.post('/res_static/business').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ code: 0, msg: 'success', data: { ok: true } });
  });

  it('keeps normal API routes under /api with the platform envelope', async () => {
    const res = await request.get('/api/orders');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ code: 0, msg: 'success', data: { ok: true } });
    expect(res.body.requestId).toBeDefined();
  });

  it('serves legacy /api/v1 success responses without the platform envelope', async () => {
    const res = await request.get('/api/v1/settings/capabilities');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dedicatedUiEnabled: true });
  });

  it('serves legacy /api/v1 failures in the frozen frontend error shape', async () => {
    const res = await request.get('/api/v1/settings/failure');

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      statusCode: 422,
      message: 'dedicated_line_inventory_unavailable',
      errorCode: 'UPSTREAM_OUT_OF_STOCK',
      path: '/api/v1/settings/failure',
    });
    expect(res.body.timestamp).toEqual(expect.any(String));
    expect(res.body).not.toHaveProperty('requestId');
  });

  it('maps res_static errors to code/msg/data:null without requestId', async () => {
    const res = await request.post('/res_static/inventory').send({});

    expect(res.status).toBe(422);
    expect(res.body).toEqual({ code: 'UPSTREAM_ERROR', msg: 'inventory_stale', data: null });
  });

  it('keeps the disabled static purchase error stable for OpenAPI clients', async () => {
    const res = await request.post('/res_static/buy').send({});

    expect(res.status).toBe(410);
    expect(res.body).toEqual({
      code: 'PRODUCT_DISABLED',
      msg: 'static_proxy_purchase_disabled',
      data: null,
    });
  });
});
