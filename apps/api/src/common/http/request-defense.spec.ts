import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { installRequestDefense } from './request-defense';

describe('request defense', () => {
  it('limits dedicated-line order requests separately and emits retry headers', async () => {
    const hooks: Array<(request: FastifyRequest, reply: FastifyReply) => Promise<void>> = [];
    installRequestDefense({ addHook: (_name: string, hook: (request: FastifyRequest, reply: FastifyReply) => Promise<void>) => hooks.push(hook) } as never, {
      windowMs: 60_000,
      maxRequests: 5,
      orderMaxRequests: 2,
    });
    const request = { url: '/api/dedicated-line-orders', ip: '203.0.113.5', raw: { socket: { remoteAddress: '203.0.113.5' } } };
    const reply = () => {
      const headers = new Map<string, unknown>();
      return {
        header: (name: string, value: unknown) => { headers.set(name, value); },
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
        headers,
      };
    };
    await hooks[0](request as unknown as FastifyRequest, reply() as unknown as FastifyReply);
    await hooks[0](request as unknown as FastifyRequest, reply() as unknown as FastifyReply);
    const blocked = reply();
    await hooks[0](request as unknown as FastifyRequest, blocked as unknown as FastifyReply);
    expect(blocked.code).toHaveBeenCalledWith(429);
    expect(blocked.headers.get('Retry-After')).toBeGreaterThan(0);
    expect(blocked.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'RATE_LIMITED' }));
  });
});
