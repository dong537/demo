import type { FastifyInstance } from 'fastify';

export type RequestDefenseOptions = {
  windowMs: number;
  maxRequests: number;
  orderMaxRequests: number;
  maxTrackedKeys?: number;
};

type Bucket = { startedAt: number; count: number };

export function installRequestDefense(app: FastifyInstance, options: RequestDefenseOptions): void {
  const buckets = new Map<string, Bucket>();
  const maxTrackedKeys = options.maxTrackedKeys ?? 20_000;
  app.addHook('onRequest', async (request, reply) => {
    const route = request.url.split('?')[0] ?? '/';
    const limit = route === '/api/dedicated-line-orders' ? options.orderMaxRequests : options.maxRequests;
    const key = `${request.raw.socket.remoteAddress ?? request.ip}:${route}`;
    const now = Date.now();
    const current = buckets.get(key);
    const bucket = !current || now - current.startedAt >= options.windowMs
      ? { startedAt: now, count: 0 }
      : current;
    bucket.count += 1;
    buckets.set(key, bucket);
    if (buckets.size > maxTrackedKeys) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey) buckets.delete(oldestKey);
    }
    const remaining = Math.max(0, limit - bucket.count);
    reply.header('X-RateLimit-Limit', limit);
    reply.header('X-RateLimit-Remaining', remaining);
    reply.header('X-RateLimit-Reset', Math.ceil((bucket.startedAt + options.windowMs) / 1000));
    if (bucket.count > limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.startedAt + options.windowMs - now) / 1000));
      reply.header('Retry-After', retryAfter);
      reply.code(429).send({ code: 'RATE_LIMITED', msg: 'Too many requests', data: { retryAfter } });
      return;
    }
  });
}

export function requestDefenseOptionsFromEnv(env: {
  API_RATE_LIMIT_WINDOW_MS: number;
  API_RATE_LIMIT_MAX_REQUESTS: number;
  API_RATE_LIMIT_ORDER_MAX_REQUESTS: number;
}): RequestDefenseOptions {
  return {
    windowMs: env.API_RATE_LIMIT_WINDOW_MS,
    maxRequests: env.API_RATE_LIMIT_MAX_REQUESTS,
    orderMaxRequests: env.API_RATE_LIMIT_ORDER_MAX_REQUESTS,
  };
}
