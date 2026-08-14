import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createProxyServer } from './server.mjs';
import http from 'node:http';

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe('legacy API proxy', () => {
  it('serves health without contacting the upstream', async () => {
    const proxy = createProxyServer('http://127.0.0.1:1');
    servers.push(proxy);
    await listen(proxy);

    const response = await fetch(`http://127.0.0.1:${proxy.address().port}/healthz`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  });

  it('forwards method, path, body, and authorization without logging secrets', async () => {
    const upstream = http.createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        assert.equal(request.method, 'POST');
        assert.equal(request.url, '/api/v1/dedicated/purchase-v2?x=1');
        assert.equal(request.headers.authorization, 'Bearer test-token');
        assert.equal(body, '{"skuCode":"SV"}');
        response.writeHead(201, { 'content-type': 'application/json', 'x-upstream': 'ok' });
        response.end('{"status":"queued"}');
      });
    });
    servers.push(upstream);
    await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const target = `http://127.0.0.1:${upstream.address().port}`;
    const proxy = createProxyServer(target);
    servers.push(proxy);
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));

    const response = await fetch(`http://127.0.0.1:${proxy.address().port}/api/v1/dedicated/purchase-v2?x=1`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: '{"skuCode":"SV"}',
    });

    assert.equal(response.status, 201);
    assert.equal(response.headers.get('x-upstream'), 'ok');
    assert.equal(await response.text(), '{"status":"queued"}');
  });

  it('returns 413 without forwarding a request body over 2 MiB', async () => {
    const proxy = createProxyServer('http://127.0.0.1:1');
    servers.push(proxy);
    await listen(proxy);

    const response = await fetch(`http://127.0.0.1:${proxy.address().port}/api/v1/upload`, {
      method: 'POST',
      body: Buffer.alloc(2 * 1024 * 1024 + 1, 'x'),
    });

    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: 'request_body_too_large' });
  });

  it('returns 502 when the configured upstream is unavailable', async () => {
    const proxy = createProxyServer('http://127.0.0.1:1');
    servers.push(proxy);
    await listen(proxy);

    const response = await fetch(`http://127.0.0.1:${proxy.address().port}/api/v1/health`);

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'legacy_proxy_upstream_unavailable' });
  });
});

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}
