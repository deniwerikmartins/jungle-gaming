import { EntityManager } from '@mikro-orm/postgresql';
import { WalletNotFoundError } from '../../shared/errors/domain.errors.js';
import { WalletRepository } from '../../infrastructure/database/repositories/wallet.repository.js';
import { WalletLedgerEntryRepository } from '../../infrastructure/database/repositories/wallet-ledger-entry.repository.js';
import type { LedgerDirection } from '../../domain/wallet/entities/ledger-direction.enum.js';

export interface LedgerEntryDto {
  readonly id: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  readonly money: { amount: string; currency: string };
  readonly balanceBefore: { amount: string; currency: string };
  readonly balanceAfter: { amount: string; currency: string };
  readonly createdAt: string;
}

export interface GetLedgerOutput {
  readonly walletId: string;
  readonly items: LedgerEntryDto[];
  readonly nextCursor: string | null;
}

export class GetLedgerUseCase {
  constructor(private readonly em: EntityManager) {}

  async execute(walletId: string, limit: number, cursor?: string): Promise<GetLedgerOutput> {
    const walletRepo = new WalletRepository(this.em);
    const ledgerRepo = new WalletLedgerEntryRepository(this.em);

    const wallet = await walletRepo.findById(walletId);
    if (!wallet) throw new WalletNotFoundError(walletId);

    const page = await ledgerRepo.findByWalletPaginated(walletId, limit, cursor);

    return {
      walletId,
      items: page.items.map((e) => ({
        id: e.id,
        transactionId: e.transactionId,
        direction: e.direction,
        money: e.money.toJSON(),
        balanceBefore: e.balanceBefore.toJSON(),
        balanceAfter: e.balanceAfter.toJSON(),
        createdAt: e.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }
}
