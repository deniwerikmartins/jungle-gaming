export interface MoneyDto {
  readonly amount: string;
  readonly currency: string;
}

export interface CreateWalletDto {
  readonly playerId: string;
  readonly initialBalance: MoneyDto;
}

export interface SubmitTransactionDto {
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly playerId: string;
  readonly walletId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: string;
  readonly money: MoneyDto;
  readonly referenceExternalTransactionId?: string;
}

export function validateCreateWalletDto(body: unknown): CreateWalletDto {
  const b = body as Record<string, unknown>;
  if (!b['playerId'] || typeof b['playerId'] !== 'string') {
    throw Object.assign(new Error('playerId is required and must be a string'), {
      statusCode: 400,
      code: 'INVALID_PAYLOAD',
    });
  }
  if (!b['initialBalance'] || typeof b['initialBalance'] !== 'object') {
    throw Object.assign(new Error('initialBalance is required'), {
      statusCode: 400,
      code: 'INVALID_PAYLOAD',
    });
  }
  const ib = b['initialBalance'] as Record<string, unknown>;
  if (!ib['amount'] || !ib['currency']) {
    throw Object.assign(new Error('initialBalance.amount and initialBalance.currency are required'), {
      statusCode: 400,
      code: 'INVALID_PAYLOAD',
    });
  }
  return b as unknown as CreateWalletDto;
}

export function validateSubmitTransactionDto(body: unknown): SubmitTransactionDto {
  const b = body as Record<string, unknown>;
  const required = ['providerId', 'externalTransactionId', 'playerId', 'walletId', 'roundId', 'gameId', 'kind', 'money'];
  for (const field of required) {
    if (!b[field]) {
      throw Object.assign(new Error(`${field} is required`), {
        statusCode: 400,
        code: 'INVALID_PAYLOAD',
      });
    }
  }
  return b as unknown as SubmitTransactionDto;
}
