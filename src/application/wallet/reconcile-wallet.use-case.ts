import { EntityManager } from '@mikro-orm/postgresql';
import { Money } from '../../domain/shared/value-objects/money.js';
import { WalletNotFoundError } from '../../shared/errors/domain.errors.js';
import { WalletRepository } from '../../infrastructure/database/repositories/wallet.repository.js';
import { WalletLedgerEntryRepository } from '../../infrastructure/database/repositories/wallet-ledger-entry.repository.js';

export interface ReconcileWalletOutput {
  readonly walletId: string;
  readonly storedBalance: { amount: string; currency: string };
  readonly calculatedBalance: { amount: string; currency: string };
  readonly difference: { amount: string; currency: string };
  readonly consistent: boolean;
  readonly checkedEntries: number;
}

export class ReconcileWalletUseCase {
  constructor(private readonly em: EntityManager) {}

  async execute(walletId: string): Promise<ReconcileWalletOutput> {
    const walletRepo = new WalletRepository(this.em);
    const ledgerRepo = new WalletLedgerEntryRepository(this.em);

    const wallet = await walletRepo.findById(walletId);
    if (!wallet) throw new WalletNotFoundError(walletId);

    const { calculatedAmount, entryCount } = await ledgerRepo.calculateBalance(walletId);

    const storedBalance = wallet.balance;
    const calculatedBalance = Money.from({
      amount: calculatedAmount,
      currency: wallet.currency,
    });

    const difference = storedBalance.subtract(calculatedBalance);
    const consistent = difference.isZero();

    if (!consistent) {
      // Log divergence — do NOT silently correct
      process.stderr.write(
        JSON.stringify({
          level: 'error',
          msg: 'Reconciliation divergence detected',
          walletId,
          storedBalance: storedBalance.toString(),
          calculatedBalance: calculatedBalance.toString(),
          difference: difference.toString(),
        }) + '\n',
      );
    }

    return {
      walletId,
      storedBalance: storedBalance.toJSON(),
      calculatedBalance: calculatedBalance.toJSON(),
      difference: difference.toJSON(),
      consistent,
      checkedEntries: entryCount,
    };
  }
}
