import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    { bufferLogs: true },
  );

  // Graceful shutdown: handle SIGTERM and SIGINT
  // Workers and SQS consumers check this flag before polling
  app.enableShutdownHooks();

  const port = Number(process.env['APP_PORT'] ?? 3000);
  await app.listen(port, '0.0.0.0');

  process.stdout.write(
    JSON.stringify({ level: 'info', msg: `Wagering Processor listening on port ${port}` }) + '\n',
  );
}

bootstrap().catch((err) => {
  process.stderr.write(
    JSON.stringify({ level: 'fatal', msg: 'Bootstrap failed', error: String(err) }) + '\n',
  );
  process.exit(1);
});
