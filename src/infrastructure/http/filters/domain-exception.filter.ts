import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { DomainError } from '../../../shared/errors/domain.errors.js';

interface ErrorResponse {
  statusCode: number;
  code: string;
  message: string;
  timestamp: string;
}

/**
 * Global exception filter — translates domain errors to structured HTTP responses.
 * Maps every known domain code to the correct HTTP status per engineering_hardening.md.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();

    const { statusCode, code, message } = this.resolve(exception);

    const body: ErrorResponse = {
      statusCode,
      code,
      message,
      timestamp: new Date().toISOString(),
    };

    this.logger.warn({ statusCode, code, message });

    reply.status(statusCode).send(body);
  }

  private resolve(err: unknown): { statusCode: number; code: string; message: string } {
    if (err instanceof DomainError) {
      return { statusCode: this.domainCodeToHttp(err.code), code: err.code, message: err.message };
    }

    // Plain errors with statusCode attached (from DTO validation)
    if (err instanceof Error && 'statusCode' in err) {
      const e = err as Error & { statusCode: number; code?: string };
      return {
        statusCode: e.statusCode,
        code: (e as any).code ?? 'INVALID_PAYLOAD',
        message: e.message,
      };
    }

    // Unknown / infra errors
    this.logger.error({ msg: 'Unhandled exception', err: String(err) });
    return {
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      code: 'TRANSIENT_INFRA_ERROR',
      message: 'A transient infrastructure error occurred. Retry is safe.',
    };
  }

  private domainCodeToHttp(code: string): number {
    switch (code) {
      case 'INVALID_PAYLOAD':
      case 'INVALID_MONEY_AMOUNT':
      case 'NEGATIVE_MONEY':
      case 'CURRENCY_MISMATCH':
        return HttpStatus.BAD_REQUEST; // 400

      case 'IDEMPOTENCY_KEY_REUSE_WITH_DIFFERENT_PAYLOAD':
      case 'WALLET_ALREADY_EXISTS':
        return HttpStatus.CONFLICT; // 409

      case 'INSUFFICIENT_FUNDS':
      case 'REVERSAL_WOULD_RESULT_IN_NEGATIVE_BALANCE':
      case 'REFERENCE_ALREADY_REVERTED':
      case 'INVALID_TRANSACTION_STATE':
        return HttpStatus.UNPROCESSABLE_ENTITY; // 422

      case 'WALLET_NOT_FOUND':
      case 'TRANSACTION_NOT_FOUND':
        return HttpStatus.NOT_FOUND; // 404

      case 'TRANSIENT_INFRA_ERROR':
      default:
        return HttpStatus.SERVICE_UNAVAILABLE; // 503
    }
  }
}
