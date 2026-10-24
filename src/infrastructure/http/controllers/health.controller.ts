import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';

/**
 * Health endpoints — no authentication required per spec.
 * GET /health/live  — process alive (always 200 if app is up)
 * GET /health/ready — PostgreSQL connectivity check
 */
@Controller('health')
export class HealthController {
  constructor(private readonly em: EntityManager) {}

  @Get('live')
  @HttpCode(HttpStatus.OK)
  liveness() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @HttpCode(HttpStatus.OK)
  async readiness() {
    try {
      await this.em.getConnection().execute('SELECT 1');
      return { status: 'ready', db: 'ok', timestamp: new Date().toISOString() };
    } catch (err) {
      throw Object.assign(new Error('Database not reachable'), {
        statusCode: 503,
        code: 'TRANSIENT_INFRA_ERROR',
      });
    }
  }
}
