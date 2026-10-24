# ARCHITECTURE.md — Distributed Wagering Processor

## 1. Visão Geral

O sistema é um processador financeiro distribuído para transações de apostas (iGaming). Recebe operações de múltiplos provedores via HTTP e AWS SQS FIFO, processa com garantias de idempotência, concorrência segura e auditabilidade completa.

```
┌─────────────────────────────────────────────────────────────────────┐
│                       Docker Compose Network                         │
│                                                                     │
│  ┌──────────────┐     ┌─────────────────────┐    ┌──────────────┐  │
│  │   Providers  │────▶│    NestJS/Bun        │────▶│ PostgreSQL   │  │
│  │  (HTTP/SQS)  │     │    App :3000         │    │   :5432      │  │
│  └──────────────┘     └──────────┬──────────┘    └──────────────┘  │
│                                  │                                  │
│                       ┌──────────┴──────────┐                      │
│                       │   LocalStack :4566   │                      │
│                       │                     │                      │
│                       │ wager-transactions   │◀── SQS Consumer      │
│                       │   .fifo (entrada)    │                      │
│                       │                     │                      │
│                       │ wager-events.fifo    │◀── Outbox Worker     │
│                       │   (saída eventos)    │                      │
│                       │                     │                      │
│                       │ wager-transactions   │                      │
│                       │   -dlq.fifo (DLQ)    │                      │
│                       └─────────────────────┘                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Stack e Justificativas

| Decisão | Escolha | Justificativa |
|---|---|---|
| Runtime | Bun 1.x | Performance nativa, test runner integrado, compatibilidade total com Node ecosystem |
| Framework | NestJS 10 + Fastify | DI, módulos, lifecycle hooks (shutdown); Fastify > Express em throughput |
| ORM | MikroORM 6 | Unit of Work explícito, `em.transactional()`, `LockMode.PESSIMISTIC_WRITE`, Identity Map — alinhado com DDD |
| Dinheiro | `decimal.js` via `Money` VO | Aritmética decimal exata, zero `number`/`float`, imutabilidade estrutural |
| Mensageria | AWS SQS FIFO via LocalStack 3.x | At-least-once delivery, FIFO por MessageGroupId (walletId) para ordenação intra-wallet |
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
│   ├── messaging/             ← SQS consumer, Outbox worker, PendingReference worker
│   └── http/                  ← Controllers, DTOs, filters, guards
│
└── shared/                    ← Utilitários transversais
    ├── errors/                ← DomainError e subclasses
    └── utils/                 ← generateCanonicalPayloadHash, metrics
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

O cenário é de *hot wallets* — múltiplas instâncias competindo pela mesma wallet simultaneamente. Optimistic locking com retry introduz latência e complexidade (loop de retry, backoff, limite de tentativas). Pessimistic locking é mais previsível em workloads de alta contenção e garante que exatamente uma operação vence sem precisar de retry.

**Múltiplas instâncias:** O `SELECT FOR UPDATE` opera no nível do banco, não da aplicação — funciona corretamente com N instâncias rodando simultaneamente.

**Teste de concorrência:** 50 BETs de 80.00 BRL simultâneos sobre wallet com 100.00 BRL → exatamente 1 PROCESSED, 49 REJECTED, saldo final 20.00 BRL, 1 ledger DEBIT. Verificado em `test/integration/concurrency.integration.test.ts`.

---

## 5. Transação Atômica

```
BEGIN;
  SELECT wallet FOR UPDATE             (1) lock pessimista
  CHECK idempotency key                (2) deduplicação
  UPDATE wallet.balance + version      (3) mutação de saldo
  INSERT wallet_ledger_entry           (4) auditoria imutável
  INSERT wager_transaction             (5) registro da operação
  INSERT outbox_message                (6) evento enfileirado na mesma TX
  INSERT inbox_message (se SQS)        (7) deduplicação de mensagem SQS
COMMIT;

→ DELETE SQS message (ack)             ← SOMENTE após commit
→ Outbox worker publica evento         ← assíncrono, após commit
```

Nenhum efeito externo (SQS publish, ack) ocorre antes do commit.

---

## 6. Idempotência

- **Fonte da verdade:** header `Idempotency-Key` (obrigatório em todas as submissões).
- **Hash canônico:** `payloadHash` = SHA-256 de JSON com chaves ordenadas alfabeticamente de forma recursiva. Garante que `{a:1,b:2}` e `{b:2,a:1}` produzem o mesmo hash.
- **Replay idêntico:** mesma key + mesmo payload → retorna resultado original, `idempotentReplay: true`, sem executar novamente.
- **Conflito:** mesma key + payload diferente → `409 Conflict` com `IDEMPOTENCY_KEY_REUSE_WITH_DIFFERENT_PAYLOAD`.
- **Garantia no DB:** `UNIQUE (idempotency_key)` em `wager_transactions` — segunda linha de defesa além do código.
- **Inbox SQS:** `(consumer_name, message_id)` como composite PK em `inbox_messages` — deduplicação de redeliveries do SQS.

---

## 7. Transactional Outbox

**Problema resolvido:** garantir que eventos de integração sejam publicados mesmo que o processo morra após o commit SQL mas antes de enviar ao SQS.

**Fluxo:**
1. Evento inserido em `outbox_messages` na mesma transação da operação financeira.
2. `OutboxWorkerService` (cron a cada 2s) busca mensagens pendentes com `SELECT ... FOR UPDATE SKIP LOCKED` — permite múltiplos workers concorrentes sem duplicação.
3. Publica no SQS `wager-events.fifo` com `MessageDeduplicationId = outbox_message.id`.
4. Após sucesso: `published_at = NOW()`.
5. Falha: backoff exponencial `min(2^attempts * 1s, 8min)`, campo `next_attempt_at`.

**Crash safety:** se o processo morrer após o commit mas antes do publish, o `published_at` ainda está `NULL`. Outra instância pega e publica. O `MessageDeduplicationId` garante que o SQS não aceite duplicatas na janela de 5 minutos.

**Filas separadas:** o Outbox publica em `wager-events.fifo` (saída de eventos), não na `wager-transactions.fifo` (entrada de pedidos). Isso evita que o consumer de entrada tente processar eventos de saída como novas apostas.

---

## 8. SQS Consumer / Inbox

- **Fila de entrada:** `wager-transactions.fifo` — recebe pedidos de processamento de apostas.
- **Deduplicação persistente:** `inbox_messages (consumer_name, message_id)` — composite PK. INSERT único garante que duas instâncias não processem a mesma mensagem duas vezes.
- **ACK (`DeleteMessage`)** somente após commit da transação SQL — nunca antes.
- **SIGTERM:** reseta o `VisibilityTimeout` da mensagem em-voo para 0 — outra instância a processa sem esperar o timeout padrão.
- **Erros terminais (DomainError):** ACK imediato — erros de negócio são definitivos, reprocessar apenas encheria a DLQ com falhas esperadas.
- **Erros transitórios (infra):** deixa expirar o `VisibilityTimeout` — SQS tenta novamente automaticamente. Após 5 falhas → DLQ.

---

## 9. PENDING_REFERENCE

Quando uma transação `REFUND`/`ROLLBACK` chega antes da sua referência (entrega fora de ordem em sistemas distribuídos):

1. Persiste como `PENDING_REFERENCE` — não rejeita imediatamente.
2. Publica `WagerTransactionPendingReference` no outbox.
3. `PendingReferenceWorkerService` (cron a cada 30s) reprocessa usando o mesmo use case.
4. Após `MAX_RETRIES` (default: 5): transição para `REJECTED` com `PENDING_REFERENCE_MAX_RETRIES_EXCEEDED` e evento correspondente publicado.

---

## 10. Double-Reversal Prevention

Uma transação `PROCESSED` pode ser revertida no máximo uma vez. O mecanismo:

1. Ao processar um `REFUND`/`ROLLBACK`, após encontrar e validar a transação referenciada, consulta `wager_transactions` procurando por outra transação `PROCESSED` que já aponte para o mesmo `referenceTransactionId`.
2. Se encontrar: `REJECTED` com `REFERENCE_ALREADY_REVERTED`.
3. Índice `idx_wager_reference_transaction_id` em `wager_transactions.reference_transaction_id` garante performance desta consulta.

Testado em `test/integration/wagering.integration.test.ts` — "Double-reversal prevention".

---

## 11. Autenticação (Decisão Explícita)

**Decisão: não implementado.** Conforme autorizado pela Seção 2 do edital — autenticação não pontua na tabela de avaliação.

**Ponto de extensão:** `AuthGuard` no-op em `src/infrastructure/http/guards/auth.guard.ts`.

**Design que adotaria em produção:**

```
Provider → Bearer JWT → AuthGuard
                           ↓
                   JwksClient (cache JWKS endpoint do IdP)
                           ↓
                   Verify RS256 signature + expiry
                           ↓
                   Extract { providerId, scopes }
                           ↓
                   Attach to Request context
```

IdP recomendado: **Keycloak** (OIDC completo, Client Credentials flow para provedores B2B) ou **Zitadel** (mais leve, API-first). Ambos sobem em Docker Compose sem dependências externas.

---

## 12. Observabilidade

### Logs
- Logs estruturados em JSON com `correlationId`, `messageId`, `transactionId`, `walletId`, `providerId`.
- `WARN` para erros de negócio esperados (idempotência, saldo insuficiente, reversão duplicada).
- `ERROR` para falhas de infraestrutura (transient errors).
- Sem dados sensíveis ou payloads financeiros completos nos logs.

### Métricas operacionais
Expostas via `GET /health/ready` em tempo real:

```json
{
  "metrics": {
    "transactions": { "processed": 42, "rejected": 3, "failed": 0, "pendingReference": 1 },
    "idempotency":  { "replays": 5, "conflicts": 0 },
    "outbox":       { "published": 45, "retries": 2 },
    "sqs":          { "messagesProcessed": 12, "terminalErrors": 0, "transientErrors": 0 },
    "uptimeSeconds": 3600,
    "memoryMb": 128
  }
}
```

### Health checks
- `GET /health/live` — liveness: processo vivo (sem dependências externas).
- `GET /health/ready` — readiness: verifica PostgreSQL (`SELECT 1`) + SQS (`GetQueueAttributes`) + expõe métricas. Retorna `503` se qualquer dependência não estiver alcançável.

---

## 13. Mapeamento HTTP de Erros

| Situação | HTTP | `failureCode` | Ação do provider |
|---|---|---|---|
| Payload inválido / DTO | `400` | `INVALID_PAYLOAD` | Corrigir e reenviar |
| Conflito de idempotência | `409` | `IDEMPOTENCY_KEY_REUSE_WITH_DIFFERENT_PAYLOAD` | Gerar nova key |
| Wallet duplicada | `409` | `WALLET_ALREADY_EXISTS` | Consultar wallet existente |
| Saldo insuficiente | `200` status=`REJECTED` | `INSUFFICIENT_FUNDS` | Não reenviar |
| Reversão geraria saldo negativo | `200` status=`REJECTED` | `REVERSAL_WOULD_RESULT_IN_NEGATIVE_BALANCE` | Não reenviar |
| Referência já revertida | `200` status=`REJECTED` | `REFERENCE_ALREADY_REVERTED` | Não reenviar |
| Referência não encontrada | `200` status=`PENDING_REFERENCE` | — | Aguardar reprocessamento |
| Recurso não encontrado | `404` | `WALLET_NOT_FOUND` | Verificar o ID |
| Erro transitório de infra | `503` | `TRANSIENT_INFRA_ERROR` | Retry seguro |

> Rejeições de negócio retornam **HTTP 200** com `status: REJECTED` no corpo. O HTTP 200 indica que a requisição foi corretamente processada — o resultado de negócio é definitivo. Isso permite que o provider distinga erros de transporte (5xx, retry seguro) de resultados permanentes (200 REJECTED, não reenviar).

---

## 14. Trade-offs e Limitações Conhecidas

| Item | Decisão | Trade-off |
|---|---|---|
| Pessimistic lock | Serializa operações por wallet | Menor throughput em hot wallets vs optimistic, porém mais previsível em alta contenção |
| `SKIP LOCKED` no outbox | Permite workers paralelos sem conflito | Ordering de publicação não garantido entre eventos de wallets distintas |
| Filas separadas (entrada/saída) | `wager-transactions.fifo` para entrada, `wager-events.fifo` para saída | Isolamento claro de responsabilidades; consumer de entrada nunca vê eventos de saída |
| Moeda única (`BRL`) nos testes | Simplifica o escopo de integração | Modelo é multi-moeda — conflito de moeda é testado nos testes unitários de `Money` |
| Auth stub | Economiza tempo de desenvolvimento | Ponto de extensão explícito e documentado (seção 11) |
| Cron-based workers | Simplicidade de deploy e operação | Alternativa: CDC via `pg_logical`; latência de outbox é de ~2s por design |
| Métricas em memória | Zero dependência externa | Resetam no reinício do processo; não persistem entre instâncias |
| MikroORM 6 | Unit of Work e LockMode explícitos | Curva de aprendizado maior que TypeORM, mas melhor alinhamento com DDD |
