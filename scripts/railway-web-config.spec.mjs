import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = JSON.parse(readFileSync(new URL('../apps/web/railway.json', import.meta.url), 'utf8'));
const frozenRoot = 'frozen/frontend-railway-6f71aaa1/dist';
const productionGate = readFileSync(
  new URL('../.github/workflows/production-gate.yml', import.meta.url),
  'utf8',
);

test('Railway web deployment verifies and serves the frozen frontend', () => {
  assert.match(config.build.buildCommand, /frontend:frozen:verify/);
  assert.doesNotMatch(config.build.buildCommand, /@ipeasy\/web build/);
  assert.match(config.deploy.startCommand, new RegExp(`WEB_STATIC_ROOT=${frozenRoot}`));
  assert.match(config.deploy.startCommand, /node apps\/web\/serve\.mjs/);
});

test('production gate preserves the synthetic encryption key as a 64-character string', () => {
  assert.match(productionGate, /^\s+APP_ENCRYPTION_KEY: ['"][0-9a-f]{64}['"]$/m);
});
