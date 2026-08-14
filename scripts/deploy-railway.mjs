import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRailwayConfig = resolve(root, 'railway.json');
const railwayAgentSession = process.env.RAILWAY_AGENT_SESSION || `ipeasy-deploy-${Date.now()}`;
const railwayCliScript = process.platform === 'win32' && process.env.APPDATA
  ? resolve(process.env.APPDATA, 'npm/node_modules/@railway/cli/bin/railway.js')
  : null;
const railwayCommand = process.env.RAILWAY_BIN || (railwayCliScript ? process.execPath : 'railway');
const railwayBaseArgs = process.env.RAILWAY_BIN || !railwayCliScript ? [] : [railwayCliScript];
let temporaryRailwayConfigCreated = false;
let originalRailwayConfigContent = null;

const serviceConfigs = {
  backend: {
    configPath: resolve(root, 'apps/api/railway.json'),
    healthChecks: [
      'https://backend-production-43893.up.railway.app/health',
      'https://backend-production-43893.up.railway.app/ready',
    ],
  },
  frontend: {
    configPath: resolve(root, 'apps/web/railway.json'),
    healthChecks: ['https://frontend-production-1870.up.railway.app/healthz'],
  },
  worker: {
    configPath: resolve(root, 'apps/worker/railway.json'),
    healthChecks: [],
  },
};

const terminalStatuses = new Set(['SUCCESS', 'FAILED', 'CRASHED', 'REMOVED']);

function cleanupTemporaryRailwayConfig() {
  if (!temporaryRailwayConfigCreated) {
    return;
  }

  if (originalRailwayConfigContent) {
    writeFileSync(temporaryRailwayConfig, originalRailwayConfigContent);
  } else if (existsSync(temporaryRailwayConfig)) {
    rmSync(temporaryRailwayConfig, { force: true });
  }

  originalRailwayConfigContent = null;
  temporaryRailwayConfigCreated = false;
}

function stageTemporaryRailwayConfig(configPath) {
  originalRailwayConfigContent = existsSync(temporaryRailwayConfig)
    ? readFileSync(temporaryRailwayConfig)
    : null;
  copyFileSync(configPath, temporaryRailwayConfig);
  temporaryRailwayConfigCreated = true;
}

process.once('beforeExit', cleanupTemporaryRailwayConfig);
process.once('exit', cleanupTemporaryRailwayConfig);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    cleanupTemporaryRailwayConfig();
    process.kill(process.pid, signal);
  });
}

function parseArgs(argv) {
  const options = {
    environment: process.env.RAILWAY_ENVIRONMENT || 'production',
    message: process.env.RAILWAY_DEPLOY_MESSAGE || `deploy ${new Date().toISOString()}`,
    services: ['backend', 'frontend'],
    pollIntervalMs: 10_000,
    timeoutMs: 15 * 60_000,
    skipHealth: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      return value;
    };

    if (arg === '--') {
      continue;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === '--environment' || arg === '-e') {
      options.environment = readValue();
    } else if (arg === '--message' || arg === '-m') {
      options.message = readValue();
    } else if (arg === '--services' || arg === '-s') {
      options.services = readValue()
        .split(/[,\s]+/)
        .map((service) => service.trim())
        .filter(Boolean);
    } else if (arg === '--include-worker') {
      options.services = ['backend', 'frontend', 'worker'];
    } else if (arg === '--poll-interval-ms') {
      options.pollIntervalMs = Number(readValue());
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = Number(readValue());
    } else if (arg === '--skip-health') {
      options.skipHealth = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.services.length === 0) {
    throw new Error('At least one service must be selected.');
  }

  for (const service of options.services) {
    if (!serviceConfigs[service]) {
      throw new Error(`Unknown service "${service}". Supported services: ${Object.keys(serviceConfigs).join(', ')}`);
    }
  }

  if (!Number.isFinite(options.pollIntervalMs) || options.pollIntervalMs < 1_000) {
    throw new Error('--poll-interval-ms must be at least 1000.');
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < options.pollIntervalMs) {
    throw new Error('--timeout-ms must be greater than --poll-interval-ms.');
  }

  return options;
}

function printHelp() {
  console.log(`Usage: pnpm deploy:railway [options]

Deploy Railway services with the correct temporary root railway.json.

Options:
  -s, --services <list>       Comma-separated services. Default: backend,frontend
      --include-worker        Deploy backend, frontend, and worker
  -e, --environment <name>    Railway environment. Default: production
  -m, --message <text>        Deployment message
      --skip-health           Skip HTTP health checks after deployment
      --poll-interval-ms <n>  Deployment polling interval. Default: 10000
      --timeout-ms <n>        Deployment timeout per service. Default: 900000
  -h, --help                  Show this help

Examples:
  pnpm deploy:railway
  pnpm deploy:railway -- --message "release resource pricing fixes"
  pnpm deploy:railway -- --services backend,frontend,worker
`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      RAILWAY_CALLER: process.env.RAILWAY_CALLER || 'ipeasy-deploy-script',
      RAILWAY_AGENT_SESSION: railwayAgentSession,
    },
    ...options,
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }

  return `${result.stdout || ''}${result.stderr || ''}`;
}

function runJson(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      RAILWAY_CALLER: process.env.RAILWAY_CALLER || 'ipeasy-deploy-script',
      RAILWAY_AGENT_SESSION: railwayAgentSession,
    },
  });
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
  return JSON.parse(result.stdout || 'null');
}

function ensureReady(services) {
  if (railwayCliScript && !existsSync(railwayCliScript)) {
    throw new Error(`Railway CLI script not found: ${railwayCliScript}`);
  }
  runRailway(['--version']);

  for (const service of services) {
    const { configPath } = serviceConfigs[service];
    if (!existsSync(configPath)) {
      throw new Error(`Missing Railway config for ${service}: ${configPath}`);
    }
  }
}

function parseDeploymentId(output) {
  const match = output.match(/[?&]id=([0-9a-f-]{36})/i);
  return match?.[1] ?? null;
}

function latestDeployment(service, environment) {
  const deployments = runRailwayJson(['deployment', 'list', '--service', service, '--environment', environment, '--json']);
  if (!Array.isArray(deployments) || deployments.length === 0) {
    throw new Error(`No deployments found for ${service}.`);
  }
  return deployments[0];
}

function findDeployment(service, environment, deploymentId) {
  const deployments = runRailwayJson(['deployment', 'list', '--service', service, '--environment', environment, '--json']);
  const deployment = deployments.find((item) => item.id === deploymentId);
  return deployment ?? deployments[0];
}

function deployService(service, options) {
  const config = serviceConfigs[service];
  console.log(`\n==> Deploying ${service} to ${options.environment}`);
  stageTemporaryRailwayConfig(config.configPath);

  let output = '';
  try {
    output = runRailway([
      'up',
      '--service',
      service,
      '--environment',
      options.environment,
      '--no-gitignore',
      '--detach',
      '--message',
      options.message,
    ]);
  } finally {
    cleanupTemporaryRailwayConfig();
  }

  const deploymentId = parseDeploymentId(output) ?? latestDeployment(service, options.environment).id;
  console.log(`==> ${service} deployment queued: ${deploymentId}`);
  pollDeployment(service, options.environment, deploymentId, options);
}

function runRailway(args, options = {}) {
  return run(railwayCommand, [...railwayBaseArgs, ...args], options);
}

function runRailwayJson(args) {
  return runJson(railwayCommand, [...railwayBaseArgs, ...args]);
}

function pollDeployment(service, environment, deploymentId, options) {
  const deadline = Date.now() + options.timeoutMs;
  let attempt = 1;

  while (Date.now() < deadline) {
    const deployment = findDeployment(service, environment, deploymentId);
    const status = deployment.status;
    console.log(`${service} poll ${attempt}: ${deployment.id} ${status}`);

    if (status === 'SUCCESS') {
      return;
    }

    if (terminalStatuses.has(status)) {
      throw new Error(`${service} deployment ${deployment.id} ended with ${status}.`);
    }

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, options.pollIntervalMs);
    attempt += 1;
  }

  throw new Error(`${service} deployment ${deploymentId} timed out after ${options.timeoutMs}ms.`);
}

function healthCheck(services) {
  const urls = services.flatMap((service) => serviceConfigs[service].healthChecks);
  if (urls.length === 0) {
    return;
  }

  console.log('\n==> Running health checks');
  const curlCommand = findCommand('curl.exe') ?? findCommand('curl');
  if (!curlCommand) {
    throw new Error('curl is required for health checks. Re-run with --skip-health to skip them.');
  }

  for (const url of urls) {
    console.log(`health: ${url}`);
    run(curlCommand, ['-fsS', url]);
  }
}

function findCommand(command) {
  const result = spawnSync(command, ['--version'], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'ignore',
  });
  return result.status === 0 ? command : null;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  ensureReady(options.services);

  try {
    for (const service of options.services) {
      deployService(service, options);
    }

    if (!options.skipHealth) {
      healthCheck(options.services);
    }

    console.log('\nRailway deployment completed successfully.');
  } finally {
    cleanupTemporaryRailwayConfig();
  }
}

main();
