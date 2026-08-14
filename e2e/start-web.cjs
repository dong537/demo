const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

if (require.main === module) {
  const port = Number(process.env.WEB_PORT || 4173);
  const host = process.env.WEB_HOST || '127.0.0.1';
  const apiTarget = new URL(process.env.WEB_API_PROXY_TARGET || 'http://127.0.0.1:3301');
  const distDir = path.resolve(process.cwd(), 'apps/web/dist');
  const indexPath = path.join(distDir, 'index.html');

  if (!fs.existsSync(indexPath)) {
    console.error(`E2E web dist is missing: ${indexPath}`);
    console.error('Run the web build before Playwright E2E.');
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    if (!req.url) {
      res.writeHead(400).end();
      return;
    }

    const url = new URL(req.url, `http://${host}:${port}`);
    const legacyLocation = legacyRedirectPath(url.pathname);
    if (legacyLocation) {
      res.writeHead(302, { location: `${legacyLocation}${url.search}` });
      res.end();
      return;
    }
    if (shouldProxyApi(url.pathname)) {
      proxyApi(req, res, url, apiTarget);
      return;
    }

    serveStatic(req, res, url, distDir, indexPath);
  });

  server.listen(port, host, () => {
    console.info(`E2E web server listening on http://${host}:${port}`);
    console.info(`E2E API proxy target ${apiTarget.origin}`);
  });
}

function proxyApi(req, res, url, apiTarget) {
  const client = apiTarget.protocol === 'https:' ? https : http;
  const headers = { ...req.headers, host: apiTarget.host };
  const proxyReq = client.request(
    {
      protocol: apiTarget.protocol,
      hostname: apiTarget.hostname,
      port: apiTarget.port,
      method: req.method,
      path: `${url.pathname}${url.search}`,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on('error', (error) => {
    console.error('E2E API proxy failed', error);
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    }
    res.end('Bad Gateway');
  });

  req.pipe(proxyReq);
}

function serveStatic(req, res, url, distDir, indexPath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }

  const pathname = decodeURIComponent(url.pathname);
  const requestedPath = path.resolve(distDir, `.${pathname}`);
  if (!isInsideDist(requestedPath, distDir)) {
    res.writeHead(403).end();
    return;
  }

  fs.stat(requestedPath, (error, stats) => {
    if (!error && stats.isFile()) {
      streamFile(req, res, requestedPath);
      return;
    }

    if (shouldServeSpaFallback(req, pathname)) {
      streamFile(req, res, indexPath);
      return;
    }

    res.writeHead(404).end();
  });
}

function streamFile(req, res, filePath) {
  res.writeHead(200, { 'content-type': contentType(filePath) });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

function isInsideDist(filePath, distDir) {
  return filePath === distDir || filePath.startsWith(`${distDir}${path.sep}`);
}

function shouldProxyApi(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/');
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

function shouldServeSpaFallback(req, pathname) {
  const hasFileExtension = path.extname(pathname) !== '';
  return !hasFileExtension;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.wasm': 'application/wasm',
  }[ext] || 'application/octet-stream';
}

module.exports = {
  shouldProxyApi,
  shouldServeSpaFallback,
  legacyRedirectPath,
};
