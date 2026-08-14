import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { prisma } from '@ipeasy/db';
import {
  cleanDatabase,
  createTestApp,
  loginAs,
  seedAdminUser,
  seedSite,
  TestRequest,
} from '../../../test-utils/integration-setup';

let app: NestFastifyApplication;
let request: TestRequest;
let siteId: string;

const PASSWORD = 'pw-12345';

beforeAll(async () => {
  app = await createTestApp();
  request = supertest(app.getHttpServer());
});

afterAll(async () => {
  await cleanDatabase();
  await app?.close();
});

beforeEach(async () => {
  await cleanDatabase();
  siteId = await seedSite();
});

describe('admin control-plane references', () => {
  it('returns site-scoped node groups and inbound profiles without credentials', async () => {
    const group = await prisma.node_groups.create({
      data: { siteId, code: 'hk-main', name: 'Hong Kong', regionCode: 'HK' },
    });
    await prisma.inbound_profiles.create({
      data: {
        siteId,
        nodeGroupId: group.id,
        code: 'sv-60701',
        protocol: 'VLESS',
        inboundTag: 'sv-main',
        listenPort: 60701,
      },
    });
    await seedAdminUser(siteId, null, 'PLATFORM_ADMIN', {
      email: 'control-plane-admin@example.com',
      password: PASSWORD,
    });
    const token = await loginAs(request, 'control-plane-admin@example.com', PASSWORD, siteId);

    const response = await request
      .get('/api/admin/control-plane/references')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.nodeGroups).toEqual([
      expect.objectContaining({ id: group.id, code: 'hk-main', regionCode: 'HK' }),
    ]);
    expect(response.body.data.inboundProfiles).toEqual([
      expect.objectContaining({ code: 'sv-60701', protocol: 'VLESS', listenPort: 60701 }),
    ]);
    expect(JSON.stringify(response.body.data)).not.toContain('apiCredential');
  });
});
