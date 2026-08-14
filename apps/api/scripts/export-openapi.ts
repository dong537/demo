import './_openapi-export-bootstrap';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { AppModule } from '../src/app.module';
import { setupSwagger } from '../src/modules/openapi/openapi-setup';
import { configureGlobalPrefix } from '../src/common/http/res-static-compat';

async function main(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: false },
  );
  configureGlobalPrefix(app);
  const document = setupSwagger(app);
  await app.init();

  const outPath = resolve(__dirname, '../../../packages/contracts/openapi.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(document, null, 2));
  console.log(`OpenAPI spec written to ${outPath}`);

  await app.close();
  process.exit(0);
}

main();
