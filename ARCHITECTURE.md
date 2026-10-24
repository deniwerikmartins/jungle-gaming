# ARCHITECTURE.md — Distributed Wagering Processor

## 1. Visão Geral

O sistema é um processador financeiro distribuído para transações de apostas (iGaming). Recebe operações de múltiplos provedores via HTTP e AWS SQS FIFO, processa com garantias de idempotência, concorrência segura e auditabilidade completa.

```
┌──────────────────────────────────────────────────────────────┐
│                     Docker Compose Network                    │
│                                                              │
│  ┌──────────────┐     ┌────────────────┐    ┌────────────┐  │
│  │   Providers  │────▶│  NestJS/Bun    │────▶│ PostgreSQL │  │
│  │  (HTTP/SQS)  │     │   App :3000    │    │   :5432    │  │
│  └──────────────┘     └────────┬───────┘    └────────────┘  │
│                                │                             │
│                       ┌────────▼───────┐    ┌────────────┐  │
│                       │  LocalStack    │◀───│  Outbox    │  │
│                       │  SQS :4566     │    │  Worker    │  │
│                       └────────────────┘    └────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Stack e Justificativas

| Decisão | Escolha | Justificativa |
|---|---|---|
| Runtime | Bun 1.x | Performance nativa, test runner integrado, compatibilidade total com Node ecosystem |
| Framework | NestJS 10 + Fastify | DI, módulos, lifecycle hooks (shutdown); Fastify > Express em throughput |
| ORM | MikroORM 6 | Unit of Work explícito, `em.transactional()`, `LockMode.PESSIMISTIC_WRITE`, Identity Map — alinhado com DDD |
| Dinheiro | `decimal.js` via `Money` VO | Aritmética decimal exata, zero `number`/`float`, imutabilidade estrutural |
| Mensageria | AWS SQS FIFO via LocalStack | At-least-once delivery, FIFO por MessageGroupId (walletId) para ordenação intra-wallet |
| Banco | PostgreSQL 15 | ACID, `SELECT FOR UPDATE`, constraints e CHECK no schema |

---

## 3. Arquitetura DDD em Camadas

```
src/
├── domain/                    ← Núcleo: sem dependências externas
│   ├── shared/
│   │   ├── value-objects/     ← Money, FailureCode
│   │   └── events/            ← IntegrationEvent, InboxMessage, OutboxMessage, domain-events
│   ├── wallet/
│   │   └── entities/          ← Wallet (AR), WalletLedgerEntry, LedgerDirection
│   └── wagering/
│       └── entities/          ← WagerTransaction, enums
│
├── application/               ← Casos de uso: orquestram domínio + infra
│   ├── wallet/                ← CreateWallet, GetWallet, GetLedger, ReconcileWallet
│   └── wagering/              ← ProcessWagerTransaction
│
├── infrastructure/            ← Adaptadores externos
│   ├── database/              ← MikroORM config, ORM entities, mappers, repositories
│   └── messaging/             ← SQS consumer, Outbox worker, PendingReference worker
│       └── http/              ← Controllers, DTOs, filters, guards
│
└── shared/                    ← Utilitários transversais
    ├── errors/                ← DomainError e subclasses
    └── utils/                 ← generateCanonicalPayloadHash
```

**Regra de dependência:** `domain` ← `application` ← `infrastructure`. O domínio nunca importa NestJS, MikroORM ou AWS SDK.

---

## 4. Estratégia de Concorrência

### Pessimistic Locking (`SELECT FOR UPDATE`)

A unidade de concorrência é a `walletId`. A cada operação que modifica saldo:

```sql
BEGIN;
SELECT * FROM wallets WHERE id = $1 FOR UPDATE;   -- serializa por wallet
-- ... aplicar saldo, ledger, outbox ...
COMMIT;
```

**Por que pessimistic e não optimistic?**

O cenário do desafio é de *hot wallets* — múltiplas instâncias competindo pela mesma wallet simultaneamente. Optimistic locking com retry introduz latência e complexidade (loop de retry, backoff, limite de tentativas). Pessimistic locking é mais previsível em workloads de alta contenção e garante que exatamente uma operação vence sem precisar de retry.

**Múltiplas instâncias:** O `SELECT FOR UPDATE` opera no nível do banco, não da aplicação — funciona corretamente com N instâncias rodando simultaneamente.

---

## 5. Transação Atômica

```
BEGIN;
  SELECT wallet FOR UPDATE
  CHECK idempotency key
  UPDATE wallet.balance + version
  INSERT wallet_ledger_entry
  INSERT wager_transaction
  INSERT outbox_message         ← evento enfileirado na mesma TX
  INSERT inbox_message          ← deduplicação SQS na mesma TX
COMMIT;

→ DELETE SQS message (ack)      ← SOMENTE após commit
→ Outbox worker publica evento  ← assíncrono, após commit
```

Nenhum efeito externo (SQS publish, ack) ocorre antes do commit.

---

## 6. Idempotência

- Fonte da verdade: header `Idempotency-Key` (obrigatório).
- Conflito detectado por `payloadHash` = SHA-256 de JSON canônico (chaves ordenadas recursivamente).
- Replay idêntico: retorna resultado gravado, `idempotentReplay: true`.
- Mesma key + payload diferente: `409 Conflict` com `IDEMPOTENCY_KEY_REUSE_WITH_DIFFERENT_PAYLOAD`.
- Garantia persistente: UNIQUE constraint em `wager_transactions.idempotency_key` no schema.

---

## 7. Transactional Outbox

1. Evento inserido em `outbox_messages` na mesma transação da operação financeira.
2. `OutboxWorkerService` (cron a cada 2s) busca mensagens pendentes com `SELECT FOR UPDATE SKIP LOCKED`.
3. Publica no SQS com `MessageDeduplicationId = outbox_message.id`.
4. Após sucesso: `published_at = NOW()`.
5. Falha: `scheduleRetry()` com backoff exponencial (2^n segundos, cap 8 min).

**Crash safety:** se o processo morrer após o commit mas antes do publish, outra instância publica. O `MessageDeduplicationId` garante que o SQS não aceite duplicatas na janela de 5 minutos.

---

## 8. SQS Consumer / Inbox

- Fila: `wager-transactions.fifo` com `ContentBasedDeduplication`.
- Deduplicação persistente: `inbox_messages (consumer_name, message_id)` — composite PK.
- ACK (`DeleteMessage`) somente após commit da transação SQL.
- Em `SIGTERM`: reset do visibility timeout da mensagem em-voo para 0 — outra instância a processa sem esperar.
- Erros de negócio (terminal): ack para não alimentar DLQ com erros esperados.
- Erros de infraestrutura: deixar expirar o visibility timeout (retry automático pelo SQS).

---

## 9. PENDING_REFERENCE

Quando uma transação `REFUND`/`ROLLBACK` chega antes da sua referência:

1. Persiste como `PENDING_REFERENCE`.
2. Publica `WagerTransactionPendingReference` no outbox.
3. `PendingReferenceWorkerService` (cron a cada 30s) reprocessa.
4. Após `MAX_RETRIES` (default: 5): transição para `REJECTED` com `PENDING_REFERENCE_MAX_RETRIES_EXCEEDED`.

---

## 10. Autenticação (Decisão Explícita)

**Decisão: não implementado.** Conforme autorizado pela Seção 2 do edital.

**Ponto de extensão:** `AuthGuard` no-op em `src/infrastructure/http/guards/auth.guard.ts`.

**Design que adotaria em produção:**

```
Provider → Bearer JWT → AuthGuard
                           ↓
                   JwksClient (cache JWKS)
                           ↓
                   Verify RS256 signature
                           ↓
                   Extract { providerId, scopes }
                           ↓
                   Attach to Request context
```

IdP recomendado: **Keycloak** (OIDC completo, Client Credentials flow para provedores B2B) ou **Zitadel** (mais leve, API-first). Ambos sobem em Docker Compose sem dependências externas.

---

## 11. Mapeamento HTTP de Erros

| Situação | Status | `failureCode` |
|---|---|---|
| Payload inválido / DTO | `400` | `INVALID_PAYLOAD` |
| Conflito de idempotência | `409` | `IDEMPOTENCY_KEY_REUSE_WITH_DIFFERENT_PAYLOAD` |
| Wallet duplicada | `409` | `WALLET_ALREADY_EXISTS` |
| Saldo insuficiente | `422` | `INSUFFICIENT_FUNDS` |
| Reversão geraria saldo negativo | `422` | `REVERSAL_WOULD_RESULT_IN_NEGATIVE_BALANCE` |
| Referência já revertida | `422` | `REFERENCE_ALREADY_REVERTED` |
| Referência não encontrada | `202` / `200` | `PENDING_REFERENCE` |
| Recurso não encontrado | `404` | `WALLET_NOT_FOUND` / `TRANSACTION_NOT_FOUND` |
| Erro transitório de infra | `503` | `TRANSIENT_INFRA_ERROR` |

---

## 12. Trade-offs e Limitações Conhecidas

| Item | Decisão | Trade-off |
|---|---|---|
| Pessimistic lock | Serializa por wallet | Menor throughput em hot wallets vs optimistic, porém mais seguro |
| `SKIP LOCKED` no outbox | Permite workers paralelos | Ordering não garantido entre eventos de wallets diferentes |
| Moeda única (`BRL`) nos testes | Simplifica o escopo | Modelo multi-moeda está correto — conflito de moeda é testado unitariamente |
| Auth stub | Economiza tempo | Ponto de extensão explícito, pronto para IdP real |
| Cron-based workers | Simplicidade de deploy | Uma alternativa seria stream-based (CDC via pg_logical); latência de outbox é de ~2s |
| MikroORM 6 vs TypeORM | Escolha | MikroORM tem Unit of Work e LockMode mais explícitos, melhor para DDD |
