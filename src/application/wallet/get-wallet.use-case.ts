import { EntityManager } from '@mikro-orm/postgresql';
import { WalletNotFoundError } from '../../shared/errors/domain.errors.js';
import { WalletRepository } from '../../infrastructure/database/repositories/wallet.repository.js';

export interface GetWalletOutput {
  readonly id: string;
  readonly playerId: string;
  readonly balance: { amount: string; currency: string };
  readonly version: number;
}

export class GetWalletUseCase {
  constructor(private readonly em: EntityManager) {}

  async execute(walletId: string): Promise<GetWalletOutput> {
    const repo = new WalletRepository(this.em);
    const wallet = await repo.findById(walletId);
    if (!wallet) throw new WalletNotFoundError(walletId);

    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
    };
  }
}
