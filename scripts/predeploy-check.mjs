import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

const status = git(['status', '--porcelain=v1', '--untracked-files=all'])
  .split(/\r?\n/)
  .filter(Boolean);

const allowedUncommitted = new Set([
  'railway.json',
]);

const relevant = status.filter((line) => {
  const path = line.slice(3).replace(/\\/g, '/');
  return !allowedUncommitted.has(path);
});

if (existsSync(resolve(root, 'railway.json'))) {
  console.error('predeploy: root railway.json exists. It is only allowed as a temporary CLI shim and must be removed before release verification.');
  process.exit(1);
}

if (relevant.length > 0) {
  console.error('predeploy: working tree is dirty. Commit or intentionally stash unrelated changes before deploying.');
  console.error(relevant.slice(0, 80).join('\n'));
  if (relevant.length > 80) {
    console.error(`... ${relevant.length - 80} more path(s)`);
  }
  process.exit(1);
}

console.log('predeploy: clean working tree verified.');
