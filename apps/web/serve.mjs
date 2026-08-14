import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { createGzip } from 'node:zlib';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolveStaticRoot(process.env.WEB_STATIC_ROOT);
const port = Number(process.env.PORT ?? process.env.WEB_PORT ?? 4173);
const host = '0.0.0.0';

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

if (isDirectRun()) {
  startServer();
}

function startServer() {
  const apiTarget = resolveApiProxyTarget(process.env);

  createServer(async (req, res) => {
    const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (requestUrl.pathname === '/healthz') {
      res.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
      return;
    }

    if (shouldProxyApi(requestUrl.pathname)) {
      if (!apiTarget) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ code: 502, msg: 'api_target_missing', data: null }));
        return;
      }
      await proxyApi(req, res, apiTarget);
      return;
    }

    const legacyLocation = legacyRedirectPath(requestUrl.pathname);
    if (legacyLocation) {
      res.writeHead(302, { Location: `${legacyLocation}${requestUrl.search}` });
      res.end();
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }

    const pathname = decodeURIComponent(requestUrl.pathname);
    const candidate = normalize(pathname === '/' ? '/index.html' : pathname);
    const filePath = resolve(join(root, `.${candidate}`));
    const fallbackPath = resolve(join(root, 'index.html'));
    if (!isInsideRoot(filePath)) {
      res.writeHead(403);
      res.end();
      return;
    }

    if (readableFile(filePath)) {
      streamStaticFile(req, res, filePath, pathname);
      return;
    }

    if (shouldServeSpaFallback(pathname)) {
      streamStaticFile(req, res, fallbackPath, '/index.html');
      return;
    }

    res.writeHead(404, { 'Cache-Control': 'no-store' });
    res.end();
  }).listen(port, host, () => {
    console.info(`Web server listening on ${host}:${port}`);
  });
}

function shouldProxyApi(url) {
  if (typeof url !== 'string') {
    return false;
  }

  return (
    url === '/api' ||
    url.startsWith('/api/') ||
    url === '/openapi.json' ||
    url === '/res_static' ||
    url.startsWith('/res_static/')
  );
}

function resolveStaticRoot(configuredRoot, workingDirectory = process.cwd()) {
  const explicitRoot = String(configuredRoot ?? '').trim();
  if (explicitRoot) {
    return resolve(workingDirectory, explicitRoot);
  }

  const workingDirectoryDist = resolve(workingDirectory, 'dist');
  return existsSync(join(workingDirectoryDist, 'index.html'))
    ? workingDirectoryDist
    : resolve(scriptDir, 'dist');
}

function shouldServeSpaFallback(pathname) {
  return extname(pathname) === '';
}

function legacyRedirectPath(pathname) {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  const simplePages = {
    '/index.html': '/',
    '/en-US.html': '/en-US',
    '/about.html': '/about',
    '/en-US_about.html': '/about',
    '/pricing.html': '/pricing',
    '/en-US_pricing.html': '/pricing',
    '/products_dynamic.html': '/products/dynamic',
    '/en-US_products_dynamic.html': '/products/dynamic',
    '/promotion.html': '/promotion',
    '/en-US_promotion.html': '/promotion',
    '/partners.html': '/partners',
    '/en-US_partners.html': '/partners',
    '/news.html': '/news',
    '/en-US_news.html': '/news',
    '/tutorials.html': '/tutorials',
    '/en-US_tutorials.html': '/tutorials',
    '/faq.html': '/faq',
    '/en-US_faq.html': '/faq',
    '/faq_proxy-selection.html': '/faq/proxy-selection',
    '/en-US_faq_proxy-selection.html': '/faq/proxy-selection',
    '/faq_use-cases.html': '/faq/use-cases',
    '/en-US_faq_use-cases.html': '/faq/use-cases',
    '/user-agreement.html': '/user-agreement',
    '/en-US_user-agreement.html': '/user-agreement',
    '/privacy-policy.html': '/privacy-policy',
    '/en-US_privacy-policy.html': '/privacy-policy',
    '/refund-policy.html': '/refund-policy',
    '/en-US_refund-policy.html': '/refund-policy',
  };

  if (simplePages[normalized]) {
    return simplePages[normalized];
  }

  const dynamicRules = [
    [/^\/(?:en-US_)?news_article_(.+?)(?:\.html)?$/i, '/news/article/'],
    [/^\/(?:en-US_)?tutorials_article_(.+?)(?:\.html)?$/i, '/tutorials/article/'],
    [/^\/(?:en-US_)?news_category_(.+?)(?:\.html)?$/i, '/news/category/'],
    [/^\/(?:en-US_)?tutorials_category_(.+?)(?:\.html)?$/i, '/tutorials/category/'],
  ];

  for (const [pattern, prefix] of dynamicRules) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      return `${prefix}${match[1]}`;
    }
  }

  return '';
}

async function proxyApi(req, res, targetBase) {
  const targetUrl = new URL(req.url ?? '/api', targetBase);
  const body = await readBody(req);
  const headers = sanitizeProxyRequestHeaders(req.headers, body.length);

  const client = targetUrl.protocol === 'https:' ? httpsRequest : httpRequest;
  const upstream = client(
    targetUrl,
    {
      method: req.method ?? 'GET',
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, sanitizeHeaders(upstreamRes.headers));
      upstreamRes.pipe(res);
    },
  );

  upstream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    }
    res.end(JSON.stringify({ code: 502, msg: 'api_proxy_failed', data: null }));
  });

  if (body.length > 0) {
    upstream.write(body);
  }
  upstream.end();
}

function normalizeApiProxyTarget(value) {
  const target = String(value ?? '').trim();
  if (!target) return '';

  try {
    const url = new URL(target);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.origin;
  } catch {
    return '';
  }
}

function resolveApiProxyTarget(env = process.env) {
  return (
    normalizeApiProxyTarget(env.WEB_API_PROXY_TARGET) ||
    normalizeApiProxyTarget(env.API_PUBLIC_URL) ||
    normalizeApiProxyTarget(env.API_INTERNAL_URL)
  );
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(resolve(entry)).href === import.meta.url;
}

function sanitizeHeaders(headers) {
  const next = { ...headers };
  delete next['transfer-encoding'];
  delete next['content-encoding'];
  delete next['content-length'];
  return next;
}

function sanitizeProxyRequestHeaders(headers, bodyLength) {
  const next = { ...headers };
  delete next.host;
  delete next.connection;
  delete next['content-length'];
  delete next['accept-encoding'];
  if (bodyLength === 0) {
    delete next['content-type'];
  }
  return next;
}

function streamStaticFile(req, res, filePath, requestPath) {
  const stats = statSync(filePath);
  const etag = buildEtag(stats);
  const headers = {
    'Cache-Control': cacheControlForPath(requestPath),
    'Content-Type': contentType(filePath),
    ETag: etag,
    'Last-Modified': stats.mtime.toUTCString(),
  };

  if (isFresh(req, etag, stats.mtime)) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  const gzip = acceptsGzip(req) && isCompressible(filePath);
  if (gzip) {
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
  } else {
    headers['Content-Length'] = String(stats.size);
  }

  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end('Static file read failed');
  });

  if (gzip) {
    stream.pipe(createGzip()).pipe(res);
    return;
  }

  stream.pipe(res);
}

function contentType(filePath) {
  const ext = extname(filePath).toLowerCase();
  return mimeTypes[ext] ?? 'application/octet-stream';
}

function cacheControlForPath(pathname) {
  if (pathname.startsWith('/assets/')) {
    return 'public, max-age=31536000, immutable';
  }
  if (pathname === '/index.html' || pathname === '/') {
    return 'no-cache';
  }
  return 'public, max-age=3600';
}

function acceptsGzip(req) {
  return String(req.headers['accept-encoding'] ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .some((value) => value === 'gzip' || value.startsWith('gzip;'));
}

function isCompressible(filePath) {
  return ['.css', '.html', '.js', '.json', '.map', '.svg', '.txt'].includes(extname(filePath).toLowerCase());
}

function buildEtag(stats) {
  return `W/"${stats.size.toString(16)}-${Math.trunc(stats.mtimeMs).toString(16)}"`;
}

function isFresh(req, etag, mtime) {
  if (req.headers['if-none-match'] === etag) return true;
  const modifiedSince = req.headers['if-modified-since'];
  if (!modifiedSince) return false;
  const since = Date.parse(String(modifiedSince));
  return Number.isFinite(since) && since >= Math.trunc(mtime.getTime() / 1000) * 1000;
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', rejectBody);
  });
}

function readableFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isInsideRoot(filePath) {
  return filePath === root || filePath.startsWith(`${root}\\`) || filePath.startsWith(`${root}/`);
}

export {
  cacheControlForPath,
  legacyRedirectPath,
  normalizeApiProxyTarget,
  resolveStaticRoot,
  resolveApiProxyTarget,
  sanitizeProxyRequestHeaders,
  shouldProxyApi,
  shouldServeSpaFallback,
};
