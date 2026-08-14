import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cacheControlForPath,
  normalizeApiProxyTarget,
  resolveStaticRoot,
  resolveApiProxyTarget,
  sanitizeProxyRequestHeaders,
  shouldProxyApi,
  shouldServeSpaFallback,
} from './serve.mjs';

test('web serve honors an explicit immutable static root', () => {
  const configured = resolveStaticRoot(
    'frozen/frontend-railway-6f71aaa1/dist',
    process.cwd(),
  );

  assert.match(configured.replaceAll('\\', '/'), /\/frozen\/frontend-railway-6f71aaa1\/dist$/);
});

test('web serve proxy target only accepts real http(s) upstreams', () => {
  assert.equal(normalizeApiProxyTarget('https://backend.example.com'), 'https://backend.example.com');
  assert.equal(normalizeApiProxyTarget('http://127.0.0.1:3301'), 'http://127.0.0.1:3301');
  assert.equal(normalizeApiProxyTarget('/api'), '');
  assert.equal(normalizeApiProxyTarget(''), '');
  assert.equal(normalizeApiProxyTarget('ftp://backend.example.com'), '');
});

test('web serve resolves upstream target from explicit proxy env only', () => {
  assert.equal(resolveApiProxyTarget({ WEB_API_PROXY_TARGET: 'https://backend.example.com' }), 'https://backend.example.com');
  assert.equal(resolveApiProxyTarget({ API_PUBLIC_URL: 'https://public.example.com' }), 'https://public.example.com');
  assert.equal(resolveApiProxyTarget({ API_INTERNAL_URL: 'http://10.0.0.8:3301' }), 'http://10.0.0.8:3301');
  assert.equal(resolveApiProxyTarget({ VITE_API_BASE_URL: '/api' }), '');
});

test('web serve proxies every public backend route without swallowing SPA routes', () => {
  assert.equal(shouldProxyApi('/api'), true);
  assert.equal(shouldProxyApi('/api/resources'), true);
  assert.equal(shouldProxyApi('/openapi.json'), true);
  assert.equal(shouldProxyApi('/res_static'), true);
  assert.equal(shouldProxyApi('/res_static/business'), true);
  assert.equal(shouldProxyApi('/api-keys'), false);
  assert.equal(shouldProxyApi('/apiary'), false);
  assert.equal(shouldProxyApi('/res-static'), false);
});

test('web serve uses SPA fallback only for extensionless routes', () => {
  assert.equal(shouldServeSpaFallback('/admin/dashboard'), true);
  assert.equal(shouldServeSpaFallback('/api-keys'), true);
  assert.equal(shouldServeSpaFallback('/assets/missing.js'), false);
  assert.equal(shouldServeSpaFallback('/images/missing.svg'), false);
});

test('web serve cache headers keep hashed assets immutable and html revalidating', () => {
  assert.equal(cacheControlForPath('/assets/index-abc123.js'), 'public, max-age=31536000, immutable');
  assert.equal(cacheControlForPath('/index.html'), 'no-cache');
  assert.equal(cacheControlForPath('/images/ipipd/logo.svg'), 'public, max-age=3600');
});

test('web serve strips json content type when proxying empty API requests', () => {
  const headers = sanitizeProxyRequestHeaders({
    host: 'frontend.example.com',
    connection: 'keep-alive',
    'content-length': '0',
    'content-type': 'application/json',
    authorization: 'Bearer token',
  }, 0);

  assert.deepEqual(headers, { authorization: 'Bearer token' });
});

test('web serve keeps json content type when proxying API requests with a body', () => {
  const headers = sanitizeProxyRequestHeaders({
    'content-length': '15',
    'content-type': 'application/json',
    authorization: 'Bearer token',
  }, 15);

  assert.deepEqual(headers, {
    'content-type': 'application/json',
    authorization: 'Bearer token',
  });
});
