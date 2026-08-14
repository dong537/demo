const { spawn } = require('node:child_process');

const children = [];
let shuttingDown = false;

const baseEnv = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || 'test',
  PORT: process.env.PORT || '3301',
  DATABASE_URL: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY || '0000000000000000000000000000000000000000000000000000000000000000',
  JWT_SECRET: process.env.JWT_SECRET || 'integration-test-jwt-secret',
  APP_PLATFORM_CURRENCY: process.env.APP_PLATFORM_CURRENCY || 'CNY',
  PAYMENT_CONFIRMATION_ENABLED: process.env.PAYMENT_CONFIRMATION_ENABLED || 'false',
};

if (!baseEnv.DATABASE_URL) {
  console.error('DATABASE_URL_TEST or DATABASE_URL is required for E2E servers.');
  process.exit(1);
}

console.info(`Starting E2E servers from ${process.cwd()}`);
console.info(`API: http://127.0.0.1:${baseEnv.PORT}`);
console.info('Web: http://127.0.0.1:4173');

start('api', process.execPath, ['e2e/start-api.cjs'], baseEnv, process.cwd());
start('web', process.execPath, ['e2e/start-web.cjs'], {
  ...baseEnv,
  WEB_API_PROXY_TARGET: `http://127.0.0.1:${baseEnv.PORT}`,
}, process.cwd());

process.stdin.resume();

function start(name, command, args, env, cwd) {
  console.info(`Starting ${name} server: ${command} ${args.join(' ')} (cwd=${cwd})`);
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: 'inherit',
    shell: false,
  });
  children.push(child);
  console.info(`${name} server pid: ${child.pid}`);
  child.on('error', (error) => {
    console.error(`${name} server failed to start`, error);
    if (!shuttingDown) {
      shutdown();
      process.exit(1);
    }
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`${name} server exited unexpectedly`, { code, signal });
    shutdown();
    process.exit(code ?? 1);
  });
}

function shutdown() {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

process.on('SIGINT', () => {
  shutdown();
  process.exit(130);
});
process.on('SIGTERM', () => {
  shutdown();
  process.exit(143);
});
process.on('exit', shutdown);
