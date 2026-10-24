# Jungle Gaming — Distributed Wagering Processor

Serviço financeiro distribuído para processamento de transações de apostas.
Implementação do Technical Challenge da Jungle Gaming.

---

## Stack

| Componente | Versão |
|---|---|
| Runtime | Bun 1.x |
| Framework | NestJS 10 + Fastify |
| ORM | MikroORM 6 (PostgreSQL) |
| Banco | PostgreSQL 15 |
| Mensageria | AWS SQS FIFO via LocalStack 3.x |
| Linguagem | TypeScript (modo estrito) |

---

## Pré-requisitos

- Docker e Docker Compose instalados
- Nenhuma outra dependência necessária na máquina host

---

## Setup rápido (avaliador)

```bash
# 1. Clone o repositório
git clone <repo-url>
cd jungle-gaming

# 2. Suba tudo — migrations e filas SQS criadas automaticamente
docker compose up --build

# 3. Verifique que a aplicação está pronta
curl http://localhost:3000/health/ready
```

Resposta esperada:
```json
{
  "status": "ready",
  "checks": { "db": "ok", "sqs": "ok" },
  "metrics": {
    "transactions": { "processed": 0, "rejected": 0, "failed": 0, "pendingReference": 0 },
    "idempotency": { "replays": 0, "conflicts": 0 },
    "outbox": { "published": 0, "retries": 0 },
    "uptimeSeconds": 5,
    "memoryMb": 42
  },
  "timestamp": "..."
}
```

A aplicação estará disponível em `http://localhost:3000`.

---

## Como Testar

### Opção 1 — Testes Automatizados (recomendado)

#### Testes unitários (não requerem Docker)

```bash
docker compose run --rm dev bun test test/unit
```

Cobre: `Money`, `Wallet`, `WagerTransaction`, `WalletLedgerEntry`, `InboxMessage`, `OutboxMessage`, eventos de domínio, hash canônico SHA-256, invariante de concorrência. **120 testes, zero dependências externas.**

#### Testes de integração (requerem PostgreSQL)

```bash
# 1. Suba o banco
docker compose up -d postgres

# 2. Rode os testes de integração
docker compose run --rm dev bun test test/integration
```

Cobre (22 testes):
- Criação de wallet com ledger entry OPENING
- Wallet duplicada → 409
- BET / WIN / LOSS / REFUND / ROLLBACK completos
- Idempotência: replay idêntico e conflito de payload
- PENDING_REFERENCE (entrega fora de ordem)
- **Double-reversal prevention** — segundo REFUND/ROLLBACK no mesmo alvo é rejeitado
- Reconciliação (`storedBalance === ledgerSum`)
- **Concorrência: 50 BETs simultâneos → exatamente 1 PROCESSED, 49 REJECTED, saldo final 20.00, 1 ledger DEBIT**

#### Suíte completa (142 testes)

```bash
docker compose up -d postgres
docker compose run --rm dev bun test
```

---

### Opção 2 — Postman Collection

A collection está em `postman/jungle-gaming-wagering.postman_collection.json`.

**Importar no Postman:**
1. Abra o Postman → **Import** → selecione `postman/jungle-gaming-wagering.postman_collection.json`
2. As variáveis de coleção (`walletId`, `playerId`, `betExtId`, etc.) são preenchidas automaticamente pelos scripts
3. Garanta que `{{baseUrl}}` aponta para `http://localhost:3000`
4. Execute os requests **na ordem das pastas** — cada um depende das variáveis do anterior

**Fluxo recomendado (17 requests, rodar em ordem):**

| # | Request | Resultado esperado |
|---|---|---|
| 1 | ✅ Health Live | 200 — processo vivo |
| 2 | ✅ Health Ready | 200 — DB + SQS ok, métricas |
| 3 | ✅ Criar Wallet | 201 — balance 1000.00, version 1 |
| 4 | ❌ Criar Wallet duplicada | 409 `WALLET_ALREADY_EXISTS` |
| 5 | ✅ Consultar Wallet | 200 — saldo atual |
| 6 | ❌ Consultar Wallet inexistente | 404 `WALLET_NOT_FOUND` |
| 7 | ✅ BET 25.00 | 200 PROCESSED, balance 975.00 |
| 8 | ✅ BET replay idempotente | 200 `idempotentReplay: true` |
| 9 | ✅ WIN 50.00 | 200 PROCESSED, balance 1025.00 |
| 10 | ✅ LOSS 25.00 | 200 PROCESSED, saldo inalterado |
| 11 | ✅ REFUND do BET | 200 PROCESSED, balance +25 |
| 12 | ✅ ROLLBACK do WIN | 200 PROCESSED, balance -50 |
| 13 | ⚠️ BET saldo insuficiente | 200 REJECTED `INSUFFICIENT_FUNDS` |
| 14 | ❌ Conflito de idempotência | 409 `IDEMPOTENCY_KEY_REUSE_WITH_DIFFERENT_PAYLOAD` |
| 15 | ⚠️ REFUND referência ausente | 200 PENDING_REFERENCE |
| 16 | ❌ Sem Idempotency-Key | 400 `INVALID_PAYLOAD` |
| 17 | ✅ Extrato (ledger) | 200 — entries paginadas |
| 18 | ✅ Reconciliação | 200 — `consistent: true`, `difference: 0.00` |

> **Legenda:** ✅ sucesso esperado · ❌ erro de negócio/validação esperado · ⚠️ processado com resultado negativo

**Rodar a collection inteira via Newman (CLI):**

```bash
npm install -g newman
newman run postman/jungle-gaming-wagering.postman_collection.json \
  --env-var baseUrl=http://localhost:3000
```

---

### Opção 3 — cURL rápido

```bash
# Health com métricas
curl -s http://localhost:3000/health/ready | jq

# Criar wallet
WALLET=$(curl -s -X POST http://localhost:3000/wallets \
  -H 'Content-Type: application/json' \
  -d '{"playerId":"player-001","initialBalance":{"amount":"1000.00","currency":"BRL"}}')
echo $WALLET | jq
WALLET_ID=$(echo $WALLET | jq -r '.id')

# BET
curl -s -X POST http://localhost:3000/wagering/transactions \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: provider-a:bet-001' \
  -d "{
    \"providerId\":\"provider-a\",
    \"externalTransactionId\":\"bet-001\",
    \"playerId\":\"player-001\",
    \"walletId\":\"$WALLET_ID\",
    \"roundId\":\"round-1\",
    \"gameId\":\"fortune-chimp\",
    \"kind\":\"BET\",
    \"money\":{\"amount\":\"25.00\",\"currency\":\"BRL\"}
  }" | jq

# Reconciliação
curl -s -X POST http://localhost:3000/wallets/$WALLET_ID/reconciliation | jq
```

---

## API Reference

### Criar wallet

```http
POST /wallets
Content-Type: application/json
```

```json
{
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "initialBalance": { "amount": "1000.00", "currency": "BRL" }
}
```

**Resposta 201:**
```json
{
  "id": "0192f291-27dd-7d3f-8071-5f8685deef37",
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "balance": { "amount": "1000.00", "currency": "BRL" },
  "version": 1
}
```

> Se `initialBalance.amount > 0`, uma transação interna `OPENING` é criada no mesmo commit gerando a entrada `CREDIT` no ledger. `version = 1` após o crédito inicial.

### Consultar wallet

```http
GET /wallets/:walletId
```

### Extrato (paginado com cursor opaco)

```http
GET /wallets/:walletId/ledger?limit=50&cursor=<opaque>
```

Retorna entradas do ledger em ordem cronológica decrescente. Use `nextCursor` da resposta para buscar a página seguinte. Transações `LOSS` e `REJECTED` **não geram entradas no ledger**.

### Submeter transação

```http
POST /wagering/transactions
Idempotency-Key: provider-a:transaction-123
Content-Type: application/json
```

```json
{
  "providerId": "provider-a",
  "externalTransactionId": "transaction-123",
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "walletId": "0192f291-27dd-7d3f-8071-5f8685deef37",
  "roundId": "round-987",
  "gameId": "fortune-chimp",
  "kind": "BET",
  "money": { "amount": "25.00", "currency": "BRL" }
}
```

**Resposta 200:**
```json
{
  "transactionId": "0192f298-345e-7e38-af88-e43f851a819d",
  "status": "PROCESSED",
  "balance": { "amount": "975.00", "currency": "BRL" },
  "idempotentReplay": false
}
```

**Kinds disponíveis:** `BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`

Para `REFUND` e `ROLLBACK`, inclua também:
```json
"referenceExternalTransactionId": "transaction-123"
```

**Regras de reversão:**
- `REFUND` só reverte um `BET PROCESSED`, uma única vez.
- `ROLLBACK` reverte `BET`, `WIN` ou `REFUND PROCESSED`, uma única vez.
- Uma segunda tentativa de reverter a mesma transação retorna `REJECTED` com `REFERENCE_ALREADY_REVERTED`.

### Reconciliação

```http
POST /wallets/:walletId/reconciliation
```

**Resposta 200:**
```json
{
  "walletId": "...",
  "storedBalance":     { "amount": "975.00", "currency": "BRL" },
  "calculatedBalance": { "amount": "975.00", "currency": "BRL" },
  "difference":        { "amount": "0.00",   "currency": "BRL" },
  "consistent": true,
  "checkedEntries": 3
}
```

Divergências são logadas em `stderr` e refletidas na resposta — nunca corrigidas silenciosamente.

### Health checks

```http
GET /health/live   # Liveness — processo vivo (sempre 200 se o app responde)
GET /health/ready  # Readiness — verifica PostgreSQL + SQS + expõe métricas operacionais
```

Ambos sem autenticação. O `/health/ready` retorna `503` se o banco ou o SQS não estiverem alcançáveis.

---

## Mapeamento de Status HTTP

| Situação | HTTP | Código interno |
|---|---|---|
| Payload inválido / DTO | `400` | `INVALID_PAYLOAD` |
| Conflito de idempotência | `409` | `IDEMPOTENCY_KEY_REUSE_WITH_DIFFERENT_PAYLOAD` |
| Wallet duplicada | `409` | `WALLET_ALREADY_EXISTS` |
| Saldo insuficiente (BET) | `200` status=`REJECTED` | `INSUFFICIENT_FUNDS` |
| Reversão geraria saldo negativo | `200` status=`REJECTED` | `REVERSAL_WOULD_RESULT_IN_NEGATIVE_BALANCE` |
| Referência já revertida | `200` status=`REJECTED` | `REFERENCE_ALREADY_REVERTED` |
| Referência não encontrada | `200` status=`PENDING_REFERENCE` | — |
| Recurso não encontrado | `404` | `WALLET_NOT_FOUND` / `TRANSACTION_NOT_FOUND` |
| Erro transitório de infra | `503` | `TRANSIENT_INFRA_ERROR` |

> **Nota:** Rejeições de negócio (`INSUFFICIENT_FUNDS`, `REFERENCE_ALREADY_REVERTED`, etc.) retornam **HTTP 200** com `status: REJECTED` no corpo. O HTTP 200 indica que a requisição foi corretamente processada — o resultado de negócio é o REJECTED. Isso permite que o provider distinga erros de transporte (5xx) de resultados de negócio definitivos.

---

## Filas SQS

**Entrada (consumer):** `wager-transactions.fifo` — recebe pedidos de processamento de apostas dos provedores.

**Saída (outbox):** `wager-events.fifo` — recebe eventos de integração publicados pelo Outbox worker (`WalletBalanceChanged`, `WagerTransactionProcessed`, `WagerTransactionRejected`, `WagerTransactionPendingReference`).

**DLQ:** `wager-transactions-dlq.fifo` — mensagens que falharam 5 vezes são roteadas aqui automaticamente.

**Formato de mensagem de entrada:**
```json
{
  "messageId": "msg-123",
  "type": "WagerTransactionRequested",
  "occurredAt": "2026-07-29T15:00:00.000Z",
  "data": {
    "providerId": "provider-a",
    "externalTransactionId": "transaction-123",
    "idempotencyKey": "provider-a:transaction-123",
    "playerId": "...",
    "walletId": "...",
    "roundId": "round-987",
    "gameId": "fortune-chimp",
    "kind": "BET",
    "money": { "amount": "25.00", "currency": "BRL" }
  }
}
```

---

## Estrutura do Projeto

```
src/
├── domain/               # Núcleo DDD — sem dependências externas
│   ├── shared/           # Money, FailureCode, IntegrationEvent, InboxMessage, OutboxMessage
│   ├── wallet/           # Wallet (AR), WalletLedgerEntry, LedgerDirection
│   └── wagering/         # WagerTransaction, enums
├── application/          # Casos de uso
│   ├── wallet/           # CreateWallet, GetWallet, GetLedger, ReconcileWallet
│   └── wagering/         # ProcessWagerTransaction
├── infrastructure/       # Adaptadores externos
│   ├── database/         # MikroORM, migrations, repositórios
│   ├── messaging/        # SQS consumer, Outbox worker, PendingReference worker
│   └── http/             # Controllers, DTOs, filtros, guards
└── shared/
    ├── errors/           # DomainError e subclasses
    └── utils/            # canonical-hash, metrics

test/
├── unit/domain/          # 120 testes unitários (sem infra)
└── integration/          # 22 testes com PostgreSQL real

postman/
└── jungle-gaming-wagering.postman_collection.json
```

---

## Arquitetura e Decisões Técnicas

Ver [ARCHITECTURE.md](./ARCHITECTURE.md) para: diagrama de componentes, estratégia de concorrência, fluxo da transação atômica, transactional outbox, idempotência, decisão sobre autenticação, mapeamento completo de erros e tabela de trade-offs.
