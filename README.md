# Jungle Gaming — Distributed Wagering Processor

Serviço financeiro distribuído para processamento de transações de apostas.
Implementação do Technical Challenge da Jungle Gaming.

## Stack

| Componente | Versão |
|---|---|
| Runtime | Bun 1.x |
| Framework | NestJS 10 + Fastify |
| ORM | MikroORM 6 (PostgreSQL) |
| Banco | PostgreSQL 15 |
| Mensageria | AWS SQS via LocalStack |
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
# {"status":"ready","db":"ok","timestamp":"..."}
```

A aplicação estará disponível em `http://localhost:3000`.

---

## Comandos de desenvolvimento

```bash
# Instalar dependências (via container Bun isolado)
docker compose run --rm dev bun install

# Rodar todos os testes unitários
docker compose run --rm dev bun test test/unit

# Rodar testes de integração (requer postgres + localstack rodando)
docker compose run --rm dev bun test test/integration

# Rodar suíte completa
docker compose run --rm dev bun test

# Rodar migrations manualmente
docker compose run --rm dev bun run migration:run

# Reverter última migration
docker compose run --rm dev bun run migration:revert
```

---

## API Reference

### Criar wallet

```http
POST /wallets
Content-Type: application/json

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

### Consultar wallet

```http
GET /wallets/:walletId
```

### Extrato (paginado com cursor)

```http
GET /wallets/:walletId/ledger?limit=50&cursor=<opaque>
```

### Submeter transação

```http
POST /wagering/transactions
Idempotency-Key: provider-a:transaction-123
Content-Type: application/json

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

Para `REFUND` e `ROLLBACK`, incluir:
```json
"referenceExternalTransactionId": "transaction-123"
```

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
  "checkedEntries": 42
}
```

### Health checks

```http
GET /health/live   # Liveness — processo vivo
GET /health/ready  # Readiness — DB alcançável
```

Ambos sem autenticação.

---

## Mapeamento de Status HTTP

| Situação | Status | Código |
|---|---|---|
| Payload inválido | `400` | `INVALID_PAYLOAD` |
| Conflito de idempotência | `409` | `IDEMPOTENCY_KEY_REUSE_WITH_DIFFERENT_PAYLOAD` |
| Wallet duplicada | `409` | `WALLET_ALREADY_EXISTS` |
| Saldo insuficiente | `422` | `INSUFFICIENT_FUNDS` |
| Reversão geraria saldo negativo | `422` | `REVERSAL_WOULD_RESULT_IN_NEGATIVE_BALANCE` |
| Referência já revertida | `422` | `REFERENCE_ALREADY_REVERTED` |
| Referência não encontrada | `200` | `status: PENDING_REFERENCE` |
| Não encontrado | `404` | `WALLET_NOT_FOUND` |
| Erro transitório | `503` | `TRANSIENT_INFRA_ERROR` |

---

## Mensagem SQS

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

**Fila principal:** `wager-transactions.fifo`  
**DLQ:** `wager-transactions-dlq.fifo`

---

## Arquitetura e Decisões Técnicas

Ver [ARCHITECTURE.md](./ARCHITECTURE.md) para:
- Diagrama de componentes
- Estratégia de concorrência (pessimistic locking)
- Transação atômica (wallet + ledger + outbox + inbox)
- Transactional Outbox pattern
- Idempotência canônica (SHA-256 de JSON com chaves ordenadas)
- Decisão sobre autenticação e ponto de extensão

---

## Estrutura do Projeto

```
src/
├── domain/          # Núcleo DDD — sem dependências externas
├── application/     # Casos de uso
├── infrastructure/  # Adaptadores (DB, HTTP, SQS)
└── shared/          # Utilitários transversais

test/
├── unit/domain/     # Testes unitários (120 testes)
└── integration/     # Testes de integração (requer containers)
```
