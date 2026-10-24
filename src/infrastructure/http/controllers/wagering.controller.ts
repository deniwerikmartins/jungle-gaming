import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  Headers,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { FastifyRequest } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { AuthGuard } from '../guards/auth.guard.js';
import { ProcessWagerTransactionUseCase } from '../../../application/wagering/process-wager-transaction.use-case.js';
import { WagerTransactionRepository } from '../../../infrastructure/database/repositories/wager-transaction.repository.js';
import { WalletRepository } from '../../../infrastructure/database/repositories/wallet.repository.js';
import { WalletLedgerEntryRepository } from '../../../infrastructure/database/repositories/wallet-ledger-entry.repository.js';
import { OutboxMessageRepository } from '../../../infrastructure/database/repositories/outbox-message.repository.js';
import { WagerTransactionKind } from '../../../domain/wagering/entities/wager-transaction.enums.js';
import { validateSubmitTransactionDto } from '../dtos/create-wallet.dto.js';
import { TransactionNotFoundError } from '../../../shared/errors/domain.errors.js';

@Controller('wagering')
@UseGuards(AuthGuard)
export class WageringController {
  constructor(private readonly em: EntityManager) {}

  @Post('transactions')
  @HttpCode(HttpStatus.OK)
  async submitTransaction(
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    if (!idempotencyKey) {
      throw Object.assign(new Error('Idempotency-Key header is required'), {
        statusCode: 400,
        code: 'INVALID_PAYLOAD',
      });
    }

    const dto = validateSubmitTransactionDto(body);
    const correlationId = (req.headers['x-correlation-id'] as string) ?? uuidv4();

    const kind = dto.kind as WagerTransactionKind;
    if (!Object.values(WagerTransactionKind).includes(kind)) {
      throw Object.assign(new Error(`Invalid transaction kind: ${dto.kind}`), {
        statusCode: 400,
        code: 'INVALID_PAYLOAD',
      });
    }

    const useCase = new ProcessWagerTransactionUseCase(
      this.em,
      new WalletRepository(this.em),
      new WagerTransactionRepository(this.em),
      new WalletLedgerEntryRepository(this.em),
      new OutboxMessageRepository(this.em),
    );

    return useCase.execute({
      idempotencyKey,
      providerId: dto.providerId,
      externalTransactionId: dto.externalTransactionId,
      playerId: dto.playerId,
      walletId: dto.walletId,
      roundId: dto.roundId,
      gameId: dto.gameId,
      kind,
      money: dto.money,
      referenceExternalTransactionId: dto.referenceExternalTransactionId,
      correlationId,
    });
  }

  @Get('transactions/:transactionId')
  async getTransaction(@Param('transactionId') transactionId: string) {
    const repo = new WagerTransactionRepository(this.em);
    const tx = await repo.findById(transactionId);
    if (!tx) throw new TransactionNotFoundError(transactionId);
    return {
      transactionId: tx.id,
      status: tx.status,
      kind: tx.kind,
      money: tx.money.toJSON(),
      failureCode: tx.failureCode,
      processedAt: tx.processedAt?.toISOString(),
    };
  }
}
