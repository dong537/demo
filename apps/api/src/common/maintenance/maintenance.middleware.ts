import { Injectable, NestMiddleware } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '@ipeasy/db';
import { ErrorCode } from '../errors/error-codes';
import { requestIdStorage } from '../logging/request-id.context';

const BYPASS_PATHS = ['/health', '/ready', '/api/auth/login', '/api/sites/current'];

type RawRequestWithAuthContext = FastifyRequest['raw'] & {
  authContext?: {
    ownerType?: string;
  };
};

@Injectable()
export class MaintenanceMiddleware implements NestMiddleware {
  async use(req: FastifyRequest['raw'], res: FastifyReply['raw'], next: () => void): Promise<void> {
    const url = req.url ?? '';
    const path = url.split('?')[0];

    if (isBypassPath(path, req.method ?? 'GET')) {
      return next();
    }

    // If request already has authContext with PLATFORM_ADMIN, skip check
    const authCtx = (req as RawRequestWithAuthContext).authContext;
    if (authCtx?.ownerType === 'PLATFORM_ADMIN') {
      return next();
    }

    const host = (req.headers['host'] ?? '').split(':')[0];
    const site = await prisma.sites.findFirst({
      where: { OR: [{ domain: host }, {}] },
      orderBy: { createdAt: 'asc' },
      select: { maintenanceMode: true, maintenanceMessage: true },
    });

    if (site?.maintenanceMode) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        code: ErrorCode.UPSTREAM_DISABLED,
        msg: site.maintenanceMessage ?? 'Service is under maintenance',
        data: { reasonKey: 'site_maintenance' },
        requestId: requestIdStorage.getStore() ?? '',
      }));
      return;
    }

    next();
  }
}

function isBypassPath(path: string, method: string): boolean {
  if (BYPASS_PATHS.some((p) => path === p || path.startsWith(p + '/'))) return true;
  return method === 'GET' && /^\/api\/tenants\/[^/]+\/brand$/.test(path);
}
