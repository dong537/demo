import { Controller, Get, Res } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { Socket } from 'net';
import { prisma } from '@ipeasy/db';
import { env } from '../../common/config/env.schema';

@Controller()
export class HealthController {
  @Get('health')
  health(@Res() reply: FastifyReply): void {
    reply.status(200).send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      releaseGitSha: env.RELEASE_GIT_SHA,
    });
  }

  @Get('ready')
  async ready(@Res() reply: FastifyReply): Promise<void> {
    const timestamp = new Date().toISOString();
    const checks = {
      db: await checkDb(),
      redis: await checkRedis(env.REDIS_URL),
    };
    const ok = checks.db.ok && checks.redis.ok;
    reply.status(ok ? 200 : 503).send({ status: ok ? 'ok' : 'error', timestamp, checks });
  }
}

async function checkDb(): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'db_check_failed' };
  }
}

async function checkRedis(redisUrl: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = new URL(redisUrl);
    const host = url.hostname;
    const port = Number(url.port || 6379);
    await pingTcp(host, port);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'redis_check_failed' };
  }
}

function pingTcp(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const cleanup = (): void => {
      socket.removeAllListeners();
      socket.destroy();
    };
    socket.setTimeout(1_000);
    socket.once('connect', () => {
      cleanup();
      resolve();
    });
    socket.once('timeout', () => {
      cleanup();
      reject(new Error('redis_timeout'));
    });
    socket.once('error', (error) => {
      cleanup();
      reject(error);
    });
    socket.connect(port, host);
  });
}
