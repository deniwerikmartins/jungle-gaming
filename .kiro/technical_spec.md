# Especificação Técnica de Implementação — Distributed Wagering Processor

Este documento define as diretrizes arquiteturais, restrições e o plano de implementação para o desenvolvimento do desafio **Distributed Wagering Processor** pela IA Kiro, garantindo foco no core do negócio e máxima nota nos critérios de avaliação dentro do prazo de 2 dias.

---

## 1. Diretrizes Principais e Restrições Invioláveis

1. **Stack Obrigatória:** Bun 1.x (Runtime/PackageManager/Test Runner), NestJS (TypeScript em modo estrito), PostgreSQL, AWS SQS via LocalStack, Docker Compose, MikroORM (preferencial) ou TypeORM.
2. **Dinheiro:** **PROIBIDO** o uso de `number`, `float` ou `double` para valores monetários. Toda representação de saldo ou movimentação DEVE utilizar a classe imutável `Money` encapsulando `Decimal.js` (ou equivalente) com exatamente 2 casas decimais.
3. **Autenticação:** **NÃO implementar IdP externo (Keycloak/Zitadel)**. Implementar uma interface/extensão `AuthGuard` no-op ou stub simples que apenas valida o canal/header para economizar tempo, conforme autorizado pela Seção 2 do edital.
4. **Concorrência e Locks:** Utilizar **Pessimistic Locking (`SELECT ... FOR UPDATE`)** ao carregar a `Wallet` por `walletId` dentro de transações SQL do ORM. **Proibido** o uso de lock em memória ou lock global.
5. **Atomicidade:** Alteração do saldo da `Wallet`, criação do lançamento no `WalletLedgerEntry`, registro na `InboxMessage` (para mensagens SQS) e enfileiramento na `OutboxMessage` **DEVEM ser executados na mesma transação SQL**.
6. **Idempotência Persistente:** Verificação obrigatória via `Idempotency-Key` (header) e validação de conflito de payload por hash de JSON canônico (`payloadHash`).

---

## 2. Modelagem de Domínio (DDD Strict)

### 2.1 Value Object: `Money`
- Imutável. Retorna novas instâncias a cada operação aritmética.
- Construtor `private` + factory estática `from({ amount: string, currency: string })`.
- Aceita apenas string decimal válida (2 casas decimais). Lança exceção de domínio para valores negativos (onde aplicável), notação científica ou moedas divergentes em operações.

### 2.2 Aggregate Root: `Wallet`
- Invariante: Saldo nunca pode ser menor que zero.
- No máximo 1 Wallet por `playerId` + `currency`.
- Atributo `version` incrementado a cada alteração de saldo.
- Alterações atreladas obrigatoriamente à geração de um `WalletLedgerEntry`.

### 2.3 Entity: `WagerTransaction`
- Enum `WagerTransactionKind`: `OPENING`, `BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`.
- Enum `WagerTransactionStatus`: `PENDING`, `PENDING_REFERENCE`, `PROCESSED`, `REJECTED`, `FAILED`.
- Estados `PROCESSED`, `REJECTED` e `FAILED` são terminais.
- Exige `referenceExternalTransactionId` para `REFUND` e `ROLLBACK`.
- Se a referência não for encontrada no momento do processamento, definir status como `PENDING_REFERENCE`.

### 2.4 Entity: `WalletLedgerEntry` (Imutável)
- Sem setters ou alteração pós-criação.
- Direções: `DEBIT`, `CREDIT`.
- Armazena `balanceBefore`, `balanceAfter` e `money`. Valida na factory: `balanceBefore ± money === balanceAfter`.
- **Transações `LOSS` ou `REJECTED` NÃO geram entrada no ledger.**

### 2.5 Entities: `InboxMessage` e `OutboxMessage`
- `InboxMessage`: Deduplicação por chave composta `(consumerName, messageId)`.
- `OutboxMessage`: Registro do evento de integração a ser publicado assincronamente por worker background.

---

## 3. Arquitetura de Banco de Dados e Schemas

### Constraints Obrigatórias no PostgreSQL
1. `wallets`: Unique index em `(player_id, currency)`. Check constraint `balance_amount >= 0`.
2. `wager_transactions`: Unique index em `idempotency_key`.
3. `inbox_messages`: Primary key / Unique index em `(consumer_name, message_id)`.
4. `wallet_ledger_entries`: Imutabilidade via ausência de endpoints/métodos de update e triggers/constraints de runtime.

---

## 4. Regras de Negócio e Casos de Uso

| Operação | Efeito na Wallet | Direção no Ledger | Regra Principal |
|---|---|---|---|
| `BET` | Débito | `DEBIT` | Rejeitar (`REJECTED`) se saldo < valor da aposta. |
| `WIN` | Crédito | `CREDIT` | Aplica crédito na wallet. |
| `LOSS` | Nenhum | Nenhuma | Registra transação como `PROCESSED` sem mover saldo ou ledger. |
| `REFUND` | Crédito | `CREDIT` | Reverte uma `BET` `PROCESSED`. Não reverte duas vezes. |
| `ROLLBACK` | Inverso da referência | Invertida | Reverte `BET`, `WIN` ou `REFUND` `PROCESSED`. |

### Tratamento de `PENDING_REFERENCE`
- Criar um Cron/Worker agendado que consulta transações `PENDING_REFERENCE` e tenta reprocessá-las com backoff exponencial.
- Limite de tentativas: 5 vezes. Se esgotar: transiciona para `REJECTED` com `failureCode` apropriado e publica evento `WagerTransactionRejected`.

---

## 5. Endpoints HTTP & SQS

### HTTP APIs
- `POST /wallets`: Cria wallet + lança transação interna `OPENING` se saldo inicial > 0.
- `GET /wallets/:walletId`: Consulta saldo e versão.
- `GET /wallets/:walletId/ledger`: Extrato paginado com cursor opaco.
- `POST /wagering/transactions`: Processamento principal de apostas (valida `Idempotency-Key` e `payloadHash`).
- `POST /wallets/:walletId/reconciliation`: Compara saldo armazenado na wallet com o somatório histórico do ledger.
- `GET /health/live` e `GET /health/ready`: Sem autenticação, verifica liveness do processo e conectividade com DB + SQS.

### Worker SQS / Consumidor
- Escuta a fila `wager-transactions.fifo`.
- Executa a mesma lógica de Use Case da camada HTTP.
- Registra `InboxMessage` na mesma transação.
- Efetua `ack` na mensagem no SQS **somente após o commit da transação SQL**.

---

## 6. Worker Outbox (Publisher Assíncrono)

- Worker rodando em loop/cron responsável por buscar registros em `outbox_messages` onde `published_at IS NULL` e `next_attempt_at <= NOW()`.
- Publica o envelope JSON do evento no SQS/SNS local.
- Atualiza `published_at` após envio bem-sucedido.
- Em caso de falha, incrementa `attempts` e calcula backoff exponencial.

---

## 7. Estratégia de Testes Automatizados

1. **Testes Unitários:**
   - Aritmética, validações de escala e regras do `Money`.
   - Transições de estado válidas e inválidas de `WagerTransaction`.
2. **Testes de Integração (Container PostgreSQL + LocalStack reais):**
   - Transacionalidade simultânea entre Wallet, Ledger e Outbox.
   - Replay idempotente (mesma chave/payload retorna resposta gravada; mesma chave/payload diferente gera conflito).
3. **Teste de Concorrência (Obrigatório):**
   - Disparar **50 requisições simultâneas (Promise.all)** contra a mesma wallet com saldo de `100.00 BRL` tentando debitar `80.00 BRL`.
   - Invariante esperada: Exatamente 1 aposta processada (`PROCESSED`), 49 rejeitadas por saldo insuficiente (`REJECTED`), saldo final de `20.00 BRL` e exatamente 1 entrada de débito no ledger.