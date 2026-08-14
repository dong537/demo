const assert = require('node:assert/strict');
const test = require('node:test');

const { legacyRedirectPath, shouldProxyApi, shouldServeSpaFallback } = require('./start-web.cjs');

test('web preview only proxies /api and /api/... paths', () => {
  assert.equal(shouldProxyApi('/api'), true);
  assert.equal(shouldProxyApi('/api/resources'), true);
  assert.equal(shouldProxyApi('/api-keys'), false);
  assert.equal(shouldProxyApi('/apiary'), false);
});

test('web preview serves SPA fallback for extensionless routes', () => {
  assert.equal(shouldServeSpaFallback({ headers: {} }, '/buy'), true);
  assert.equal(shouldServeSpaFallback({ headers: {} }, '/wallet'), true);
  assert.equal(shouldServeSpaFallback({ headers: {} }, '/api-keys'), true);
  assert.equal(shouldServeSpaFallback({ headers: {} }, '/'), true);
});

test('web preview preserves static asset 404 behavior', () => {
  assert.equal(shouldServeSpaFallback({ headers: {} }, '/assets/missing.js'), false);
  assert.equal(shouldServeSpaFallback({ headers: {} }, '/images/missing.svg'), false);
});

test('web preview does not hide missing assets for browser HTML accept requests', () => {
  assert.equal(shouldServeSpaFallback({ headers: { accept: 'text/html,application/xhtml+xml' } }, '/assets/missing.js'), false);
  assert.equal(shouldServeSpaFallback({ headers: { accept: 'text/html,application/xhtml+xml' } }, '/buy'), true);
});

test('web preview redirects crawled official html routes to canonical public routes', () => {
  assert.equal(legacyRedirectPath('/en-US.html'), '/en-US');
  assert.equal(legacyRedirectPath('/en-US_pricing.html'), '/pricing');
  assert.equal(legacyRedirectPath('/faq_proxy-selection.html'), '/faq/proxy-selection');
  assert.equal(legacyRedirectPath('/en-US_faq_use-cases.html'), '/faq/use-cases');
  assert.equal(legacyRedirectPath('/news_article_ntt123.html'), '/news/article/ntt123');
  assert.equal(legacyRedirectPath('/en-US_news_article_what-is-static-residential-proxy.html'), '/news/article/what-is-static-residential-proxy');
  assert.equal(legacyRedirectPath('/tutorials_article_zhuce.html'), '/tutorials/article/zhuce');
  assert.equal(legacyRedirectPath('/en-US_tutorials_category_Getting_Started_Guide.html'), '/tutorials/category/Getting_Started_Guide');
});
