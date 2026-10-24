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

## Como Testar

### Opção 1 — Testes Automatizados (recomendado)

#### Testes unitários (não requerem Docker)

```bash
docker compose run --rm dev bun test test/unit
```

Cobre: `Money`, `Wallet`, `WagerTransaction`, `WalletLedgerEntry`, `InboxMessage`, `OutboxMessage`, eventos de domínio, hash canônico, invariante de concorrência. **120 testes, zero dependências externas.**

#### Testes de integração (requerem PostgreSQL)

```bash
# 1. Suba somente o banco
docker compose up -d postgres

# 2. Rode os testes de integração
docker compose run --rm dev bun test test/integration
```

Cobre:
- Criação de wallet com ledger entry OPENING
- Wallet duplicada → 409
- BET / WIN / LOSS / REFUND / ROLLBACK completos
- Idempotência: replay idêntico e conflito de payload
- PENDING_REFERENCE
- Reconciliação (storedBalance === ledgerSum)
- **Concorrência: 50 BETs simultâneos → exatamente 1 PROCESSED, 49 REJECTED, saldo final 20.00**

#### Suíte completa

```bash
# Sobe banco + localstack e roda tudo
docker compose up -d postgres localstack
docker compose run --rm dev bun test
```

---

### Opção 2 — Postman Collection

A collection está em `postman/jungle-gaming-wagering.postman_collection.json`.

**Importar no Postman:**
1. Abra o Postman → **Import** → selecione o arquivo `postman/jungle-gaming-wagering.postman_collection.json`
2. As variáveis de coleção (`walletId`, `playerId`, etc.) são preenchidas automaticamente pelos scripts dos requests
3. Garanta que `{{baseUrl}}` aponta para `http://localhost:3000`

**Fluxo recomendado da collection (rodar em ordem):**

| # | Request | O que verifica |
|---|---|---|
| 1 | Health Live | Processo vivo |
| 2 | Health Ready | DB conectado |
| 3 | Criar Wallet | 201, balance 1000.00, versão 1 |
| 4 | Criar Wallet duplicada | 409 WALLET_ALREADY_EXISTS |
| 5 | Consultar Wallet | 200 com saldo |
| 6 | BET 25.00 | 200 PROCESSED, balance 975.00 |
| 7 | BET replay idempotente | 200 idempotentReplay: true |
| 8 | WIN 50.00 | 200 PROCESSED, balance 1025.00 |
| 9 | LOSS 25.00 | 200 PROCESSED, saldo inalterado |
| 10 | REFUND do BET | 200 PROCESSED, balance +25 |
| 11 | ROLLBACK do WIN | 200 PROCESSED, balance -50 |
| 12 | BET saldo insuficiente | 200 REJECTED |
| 13 | Conflito idempotência | 409 IDEMPOTENCY_KEY_REUSE |
| 14 | REFUND sem referência | 200 PENDING_REFERENCE |
| 15 | Sem Idempotency-Key | 400 INVALID_PAYLOAD |
| 16 | Extrato (ledger) | 200 com entries |
| 17 | Reconciliação | 200 consistent: true, difference: 0.00 |

**Rodar a collection inteira via Newman (CLI):**

```bash
# Instalar Newman
npm install -g newman

# Rodar toda a collection
newman run postman/jungle-gaming-wagering.postman_collection.json \
  --env-var baseUrl=http://localhost:3000
```

---

### Opção 3 — cURL rápido

```bash
# Criar wallet
curl -s -X POST http://localhost:3000/wallets \
  -H 'Content-Type: application/json' \
  -d '{"playerId":"player-1","initialBalance":{"amount":"1000.00","currency":"BRL"}}' | jq

# Apostar
curl -s -X POST http://localhost:3000/wagering/transactions \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: provider-a:bet-001' \
  -d '{
    "providerId":"provider-a",
    "externalTransactionId":"bet-001",
    "playerId":"player-1",
    "walletId":"<walletId>",
    "roundId":"round-1",
    "gameId":"fortune-chimp",
    "kind":"BET",
    "money":{"amount":"25.00","currency":"BRL"}
  }' | jq

# Health
curl -s http://localhost:3000/health/ready | jq
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

**Kinds:** `BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`

Para `REFUND` e `ROLLBACK`:
```json
"referenceExternalTransactionId": "transaction-123"
```

### Reconciliação

```http
POST /wallets/:walletId/reconciliation
```

### Health checks

```http
GET /health/live   # Liveness
GET /health/ready  # Readiness (DB)
```

---

## Mapeamento de Status HTTP

| Situação | Status | Código |
|---|---|---|
| Payload inválido | `400` | `INVALID_PAYLOAD` |
| Conflito de idempotência | `409` | `IDEMPOTENCY_KEY_REUSE_WITH_DIFFERENT_PAYLOAD` |
| Wallet duplicada | `409` | `WALLET_ALREADY_EXISTS` |
| Saldo insuficiente | `422` → `200 REJECTED` | `INSUFFICIENT_FUNDS` |
| Reversão geraria saldo negativo | `422` → `200 REJECTED` | `REVERSAL_WOULD_RESULT_IN_NEGATIVE_BALANCE` |
| Referência já revertida | `422` → `200 REJECTED` | `REFERENCE_ALREADY_REVERTED` |
| Referência não encontrada | `200 PENDING_REFERENCE` | — |
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

## Estrutura do Projeto

```
src/
├── domain/          # Núcleo DDD — sem dependências externas
├── application/     # Casos de uso
├── infrastructure/  # Adaptadores (DB, HTTP, SQS)
└── shared/          # Utilitários transversais

test/
├── unit/domain/     # 120 testes unitários (sem infra)
└── integration/     # Testes reais com PostgreSQL + LocalStack

postman/
└── jungle-gaming-wagering.postman_collection.json
```

## Arquitetura e Decisões Técnicas

Ver [ARCHITECTURE.md](./ARCHITECTURE.md).
