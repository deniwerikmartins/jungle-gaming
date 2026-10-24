import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { AuthGuard } from '../guards/auth.guard.js';
import { CreateWalletUseCase } from '../../../application/wallet/create-wallet.use-case.js';
import { GetWalletUseCase } from '../../../application/wallet/get-wallet.use-case.js';
import { GetLedgerUseCase } from '../../../application/wallet/get-ledger.use-case.js';
import { ReconcileWalletUseCase } from '../../../application/wallet/reconcile-wallet.use-case.js';
import { validateCreateWalletDto } from '../dtos/create-wallet.dto.js';

@Controller('wallets')
@UseGuards(AuthGuard)
export class WalletController {
  constructor(private readonly em: EntityManager) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createWallet(@Body() body: unknown, @Req() req: FastifyRequest) {
    const dto = validateCreateWalletDto(body);
    const correlationId = (req.headers['x-correlation-id'] as string) ?? uuidv4();

    const useCase = new CreateWalletUseCase(this.em);
    return useCase.execute({
      playerId: dto.playerId,
      initialBalance: dto.initialBalance,
      correlationId,
    });
  }

  @Get(':walletId')
  async getWallet(@Param('walletId') walletId: string) {
    const useCase = new GetWalletUseCase(this.em);
    return useCase.execute(walletId);
  }

  @Get(':walletId/ledger')
  async getLedger(
    @Param('walletId') walletId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const useCase = new GetLedgerUseCase(this.em);
    return useCase.execute(walletId, Math.min(Number(limit ?? 50), 100), cursor);
  }

  @Post(':walletId/reconciliation')
  @HttpCode(HttpStatus.OK)
  async reconcile(@Param('walletId') walletId: string) {
    const useCase = new ReconcileWalletUseCase(this.em);
    return useCase.execute(walletId);
  }
}
