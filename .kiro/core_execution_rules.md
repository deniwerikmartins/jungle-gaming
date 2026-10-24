# Diretrizes Imediatas de Execução & Contexto Essencial (Quick Reference)

Este documento condensa os princípios mais importantes do projeto **Distributed Wagering Processor**. Deve ser relido periodicamente ou citado para reancorar o contexto caso a memória ou limite de contexto do modelo diminua.

---

## 1. Regras de Ouro (Invioláveis)

1. **Monetário Imutável:** **NUNCA** utilizar `number`, `float` ou `double` para dinheiro. Usar sempre a classe `Money` encapsulando aritmética decimal rigorosa de alta precisão (ex: `Decimal.js`) com exatamente 2 casas decimais.
2. **Concorrência Rígida:** Aplicar **Pessimistic Locking (`SELECT FOR UPDATE`)** ao carregar registros de `Wallet` em transações do ORM. Impedir race conditions, saldos negativos e leituras sujas em cenários concorrentes.
3. **Transação Atômica Única:** Alteração de saldo da Wallet, criação da entrada no Ledger, registro de Inbox/Deduplicação, criação de evento Outbox e validação de idempotência **DEVEM rodar dentro da MESMA transação SQL**.
4. **Isolamento Docker Total:** O ambiente deve ser 100% isolado e autônomo via `docker compose up --build`. Zero dependência do host ou de contêineres locais pré-existentes.
5. **Corte de Escopo Permitido:** Não implementar IdP externo (Keycloak/Zitadel). Usar apenas um `AuthGuard` stub/no-op para economizar tempo e focar 100% na lógica financeira e de concorrência.

---

## 2. Hardening Técnico Rápido

* **Idempotência Canônica:** Hashes SHA-256 de idempotência devem obrigatoriamente ordenar as chaves do JSON de forma recursiva antes de calcular o hash.
* **Respostas HTTP & Status:**
  * Saldo Insuficiente -> `422 Unprocessable Entity` (`INSUFFICIENT_FUNDS`)
  * Conflito de Payload/Idempotência -> `409 Conflict`
  * DTO/Payload inválido -> `400 Bad Request`
  * Erros de Infra/Timeout -> `503 Service Unavailable`
* **Graceful Shutdown:** Ativar `app.enableShutdownHooks()` para tratar `SIGTERM` e concluir transações ativas antes de desligar os consumidores SQS / Workers.

---

## 3. Protocolo de Ciclo de Vida por Fase

Para cada fase do projeto:
1. Implementar funcionalidade ou refatoração.
2. Escrever e rodar a suíte completa de testes (`bun test`).
3. Validar se zero testes falharam.
4. Fazer o commit seguindo **Conventional Commits** (ex: `feat(domain): ...`, `test(wallet): ...`).