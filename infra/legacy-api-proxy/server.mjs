import http from 'node:http';
import { pathToFileURL } from 'node:url';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export function createProxyServer(target) {
  const targetUrl = parseTarget(target);
  return http.createServer(async (request, response) => {
    if (request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"status":"ok"}');
      return;
    }

    try {
      const body = await readBody(request);
      const upstream = await fetch(new URL(request.url ?? '/', targetUrl), {
        method: request.method,
        headers: copyRequestHeaders(request.headers),
        body: body.length > 0 ? body : undefined,
        redirect: 'manual',
      });
      const headers = copyResponseHeaders(upstream.headers);
      response.writeHead(upstream.status, headers);
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === 'request_body_too_large';
      response.writeHead(tooLarge ? 413 : 502, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: tooLarge ? 'request_body_too_large' : 'legacy_proxy_upstream_unavailable' }));
    }
  });
}

function parseTarget(value) {
  const target = new URL(value);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    throw new Error('legacy_proxy_target_invalid');
  }
  return target;
}

function readBody(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return Promise.resolve(Buffer.alloc(0));
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let rejected = false;
    request.on('data', (chunk) => {
      if (rejected) return;
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        rejected = true;
        chunks.length = 0;
        reject(new Error('request_body_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    request.on('error', reject);
  });
}

function copyRequestHeaders(source) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(source)) {
    if (HOP_BY_HOP_HEADERS.has(name.toLowerCase()) || value === undefined) continue;
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else headers.set(name, value);
  }
  return headers;
}

function copyResponseHeaders(source) {
  const headers = {};
  for (const [name, value] of source.entries()) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) headers[name] = value;
  }
  return headers;
}

async function start() {
  const target = process.env.LEGACY_PROXY_TARGET;
  if (!target) throw new Error('LEGACY_PROXY_TARGET is required');
  const url = parseTarget(target);
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('LEGACY_PROXY_TARGET must use https in production');
  }
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT is invalid');
  createProxyServer(url.toString()).listen(port, '0.0.0.0');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((error) => {
    console.error(error instanceof Error ? error.message : 'legacy proxy startup failed');
    process.exit(1);
  });
}
