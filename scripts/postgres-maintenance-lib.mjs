export function parseDatabaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error('DATABASE_URL must use the PostgreSQL protocol');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!url.hostname || !database || database.includes('/')) {
    throw new Error('DATABASE_URL must include one PostgreSQL host and database name');
  }
  return {
    host: url.hostname,
    port: url.port || '5432',
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    sslMode: url.searchParams.get('sslmode') || undefined,
  };
}

export function postgresEnvironment(connection, baseEnvironment = process.env) {
  return {
    ...baseEnvironment,
    PGHOST: connection.host,
    PGPORT: connection.port,
    PGUSER: connection.username,
    PGPASSWORD: connection.password,
    PGDATABASE: connection.database,
    ...(connection.sslMode ? { PGSSLMODE: connection.sslMode } : {}),
  };
}

export function buildPgDumpArgs(_connection, outputPath) {
  return [
    '--format', 'custom',
    '--compress', '6',
    '--no-owner',
    '--no-privileges',
    '--file', outputPath,
  ];
}

export function buildPgRestoreArgs(_connection, inputPath) {
  return [
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-privileges',
    '--exit-on-error',
    inputPath,
  ];
}

export function assertRestoreAuthorized({ database, confirmDatabase, allowProduction, nodeEnv }) {
  if (!confirmDatabase || confirmDatabase !== database) {
    throw new Error('restore confirmation must exactly match the target database name');
  }
  if (nodeEnv === 'production' && !allowProduction) {
    throw new Error('production restore requires --allow-production');
  }
}
