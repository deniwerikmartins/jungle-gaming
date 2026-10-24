# Diretrizes de Workflow, Testes e Commits para o Kiro

Este documento define as regras operacionais de desenvolvimento que a IA Kiro deve seguir rigorosamente durante a implementação do projeto.

## 1. Fluxo de Desenvolvimento Incremental

O desenvolvimento deve ser realizado em etapas curtas, isoladas e testáveis. A IA **NÃO DEVE** tentar implementar múltiplos módulos complexos de uma só vez.

Para cada etapa/fase do desenvolvimento:
1. **Implementar** o código de domínio, caso de uso ou infraestrutura.
2. **Escrever / Executar** os testes correspondentes (unitários ou de integração).
3. **Executar a Suíte Completa de Testes** para garantir zero regressão.
4. **Realizar o Commit** no padrão Conventional Commits antes de iniciar a próxima fase.

---

## 2. Protocolo de Validação por Testes

Antes de considerar qualquer fase como "concluída", execute a suíte de testes completa via Bun:

```bash
bun test
```

### Regras de Ouro:
* Nenhuma alteração pode ser commitada se houver **qualquer** teste falhando.
* Se um teste quebrar após uma nova alteração, refatore imediatamente o código antes de prosseguir com novas funcionalidades.
* Para etapas que envolvem integração com o banco ou SQS, os containers do Docker Compose (`PostgreSQL` e `LocalStack`) devem estar operacionais durante a execução dos testes.

---

## 3. Padronização de Commits (Conventional Commits)

Todos os commits gerados no repositório devem seguir estritamente a convenção do **Conventional Commits**:

### Formato do Mensagem:
```text
<type>(<scope>): <short summary>
```

### Tipos Permitidos (`type`):
* `feat`: Adição de um novo recurso ou funcionalidade (ex: criação da classe `Money`, endpoint de aposta).
* `fix`: Correção de um bug ou comportamento incorreto.
* `test`: Adição ou refatoração de testes unitários/integração.
* `refactor`: Mudança no código que não altera funcionalidade nem corrige bugs.
* `docs`: Alterações na documentação (`README.md`, `ARCHITECTURE.md`).
* `chore`: Mudanças de configuração, dependências ou scripts (`docker-compose.yml`, `package.json`).

### Exemplos Válidos:
* `chore(setup): initialize project structure and docker compose for postgres and localstack`
* `feat(domain): implement immutable Money value object with precision tests`
* `feat(wallet): implement pessimistic lock and balance deduction`
* `test(concurrency): add integration test for 50 parallel bets on hot wallet`
* `fix(outbox): handle exponential backoff retry on publishing failure`

---

## 4. Ordem Recomendada de Fases (Checklist de Execution)

- [ ] **Fase 1: Setup & Infraestrutura Base**
  - Configuração do projeto (NestJS + Bun + Docker Compose).
  - *Commit:* `chore(setup): ...`
- [ ] **Fase 2: Modelo de Domínio (Value Objects & Aggregates)**
  - Implementação de `Money`, `Wallet`, `WagerTransaction`, `WalletLedgerEntry`.
  - Testes unitários do domínio.
  - *Commit:* `feat(domain): ...` e `test(domain): ...`
- [ ] **Fase 3: Persistência & Migrations (ORMs)**
  - Mapeamento das entidades, migrations e constraints de banco.
  - *Commit:* `feat(database): ...`
- [ ] **Fase 4: Casos de Uso Core & Lock Concorrente**
  - Use cases HTTP com `SELECT FOR UPDATE` na wallet e escrita transacional no Ledger.
  - Teste de concorrência massiva (50 requisições em paralelo).
  - *Commit:* `feat(wagering): ...`
- [ ] **Fase 5: Inbox, Outbox & Integração SQS**
  - Consumidor SQS (Inbox) e Worker assíncrono (Outbox).
  - *Commit:* `feat(messaging): ...`
- [ ] **Fase 6: Health Check, Reconciliação & Documentação**
  - Endpoints de health e preenchimento de `ARCHITECTURE.md` e `README.md`.
  - *Commit:* `docs(architecture): ...`