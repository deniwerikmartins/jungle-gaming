import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { sqsClient } from '../../messaging/sqs/sqs-client.provider.js';
import { GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { metrics } from '../../../shared/utils/metrics.js';

/**
 * Health endpoints — no authentication required per spec.
 * GET /health/live  — process alive (always 200 if app is up)
 * GET /health/ready — PostgreSQL + SQS connectivity check + metrics
 */
@Controller('health')
export class HealthController {
  private readonly queueUrl =
    process.env['SQS_QUEUE_URL'] ??
    'http://localstack:4566/000000000000/wager-transactions.fifo';

  constructor(private readonly em: EntityManager) {}

  @Get('live')
  @HttpCode(HttpStatus.OK)
  liveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
    };
  }

  @Get('ready')
  @HttpCode(HttpStatus.OK)
  async readiness() {
    const checks: Record<string, string> = {};
    const errors: string[] = [];

    // --- PostgreSQL check ---
    try {
      await this.em.getConnection().execute('SELECT 1');
      checks['db'] = 'ok';
    } catch (err) {
      checks['db'] = 'error';
      errors.push(`db: ${String(err)}`);
    }

    // --- SQS check ---
    try {
      await sqsClient.send(
        new GetQueueAttributesCommand({
          QueueUrl: this.queueUrl,
          AttributeNames: ['ApproximateNumberOfMessages'],
        }),
      );
      checks['sqs'] = 'ok';
    } catch (err) {
      checks['sqs'] = 'error';
      errors.push(`sqs: ${String(err)}`);
    }

    if (errors.length > 0) {
      throw Object.assign(
        new Error(`Service not ready: ${errors.join(', ')}`),
        { statusCode: 503, code: 'TRANSIENT_INFRA_ERROR' },
      );
    }

    return {
      status: 'ready',
      checks,
      metrics: metrics.toJSON(),
      timestamp: new Date().toISOString(),
    };
  }
}
