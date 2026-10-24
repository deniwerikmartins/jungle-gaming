# Diretrizes Avançadas de Engenharia & Hardening

Este documento define regras técnicas de proteção, consistência e tratamento de borda para garantir a máxima nota nos critérios de resiliência e integridade do desafio **Distributed Wagering Processor**.

---

## 1. Hash de Payload Canônico (Idempotência Estrita)

Para evitar que variações na ordem das chaves do JSON afetem o hash da idempotência ou gerem falsos conflitos:

- A geração do `payloadHash` **DEVE** serializar o JSON com as chaves ordenadas alfabeticamente de forma recursiva antes de calcular o hash **SHA-256**.
- Apenas os campos do payload de negócio devem ser considerados no hash (ignorando headers HTTP, metadados de transporte ou IDs de rastreio).

### Algoritmo de Referência:
```typescript
import { createHash } from 'crypto';

export function generateCanonicalPayloadHash(payload: Record<string, any>): string {
  const sortKeys = (obj: any): any => {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sortKeys);
    return Object.keys(obj)
      .sort()
      .reduce((acc: Record<string, any>, key: string) => {
        acc[key] = sortKeys(obj[key]);
        return acc;
      }, {});
  };

  const canonicalJson = JSON.stringify(sortKeys(payload));
  return createHash('sha256').update(canonicalJson).digest('hex');
}
```

---

## 2. Mapeamento de Erros e Status Codes HTTP

As exceções de domínio e erros de infraestrutura devem ser capturados por um `ExceptionFilter` global do NestJS e traduzidos para respostas HTTP estruturadas e previsíveis:

| Causa / Exceção de Domínio | Status HTTP | Código Interno (`failureCode`) | Descrição / Ação do Provedor |
|---|---|---|---|
| Payload malformatado / validação DTO | `400 Bad Request` | `INVALID_PAYLOAD` | Requisição inválida; não reencaminhar igual. |
| Conflito de Idempotência (mesma key, payload diferente) | `409 Conflict` | `IDEMPOTENCY_KEY_REUSE_WITH_DIFFERENT_PAYLOAD` | Idempotency Key reutilizada com dados diferentes. |
| Saldo Insuficiente (`BET`) | `422 Unprocessable Entity` | `INSUFFICIENT_FUNDS` | Aposta rejeitada por falta de saldo. |
| Reversão com saldo resultante negativo | `422 Unprocessable Entity` | `REVERSAL_WOULD_RESULT_IN_NEGATIVE_BALANCE` | Reversão negada por violar não-negatividade. |
| Referência não encontrada (`REFUND`/`ROLLBACK`) | `202 Accepted` / `200 OK` | `PENDING_REFERENCE` | Armazenada como `PENDING_REFERENCE` para retry assíncrono. |
| Operação já revertida anteriormente | `422 Unprocessable Entity` | `REFERENCE_ALREADY_REVERTED` | Referência já foi alvo de reversão. |
| Erro transitório de Infraestrutura / DB Lock Timeout | `503 Service Unavailable` | `TRANSIENT_INFRA_ERROR` | Falha temporária; o provedor/cliente pode tentar novamente. |

---

## 3. Graceful Shutdown (Tratamento de `SIGTERM`)

Os consumidores de mensagens SQS e Workers de Outbox devem responder ao sinal `SIGTERM` do sistema operacional para evitar perda de dados ou interrupção de transações no meio do processamento:

1. O NestJS deve estar configurado com `app.enableShutdownHooks()`.
2. Ao receber `SIGTERM`:
   - Interromper a leitura de novas mensagens da fila SQS / polling da Outbox.
   - Aguardar a conclusão do commit ou rollback das transações SQL em andamento.
   - Caso uma mensagem SQS não consiga concluir o processamento dentro do timeout de encerramento, o visibillity timeout da mensagem deve ser resetado para que possa ser reprocessada por outra instância sem atraso.

---

## 4. Concorrência e Integridade Transacional SQL

Todas as modificações de estado e auditorias devem rodar estritamente dentro de **uma única transação PostgreSQL** utilizando a mesma instância de `EntityManager` / `QueryRunner`:

```sql
BEGIN;

-- 1. Lock pessimista da Wallet afetada
SELECT * FROM wallets WHERE id = $1 FOR UPDATE;

-- 2. Verificação de Inbox / Idempotência na mesma transação
SELECT * FROM wager_transactions WHERE idempotency_key = $2;

-- 3. Aplicação do movimento de saldo e atualização de versão
UPDATE wallets SET balance_amount = $new_balance, version = version + 1 WHERE id = $1;

-- 4. Gravação da entrada imutável no Ledger
INSERT INTO wallet_ledger_entries (...) VALUES (...);

-- 5. Gravação da Transação de Aposta
INSERT INTO wager_transactions (...) VALUES (...);

-- 6. Enfileiramento da mensagem de integração na Outbox
INSERT INTO outbox_messages (...) VALUES (...);

COMMIT;
```

Nenhum evento pode ser enviado para a rede/SQS antes da confirmação do `COMMIT` acima.