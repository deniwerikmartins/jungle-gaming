# Diretrizes de Conteinerização e Isolamento de Ambiente

Este documento define os requisitos de infraestrutura e conteinerização para o desafio Distributed Wagering Processor. A solução deve ser 100% autônoma e executável com um único comando, sem depender de nenhum serviço rodando na máquina host.

## 1. Diretrizes de Isolamento

* Toda a aplicação (API NestJS/Bun, Workers, PostgreSQL, LocalStack) deve rodar dentro da rede do Docker Compose.
* Nenhuma dependência local (Node, Bun, Postgres instalado na máquina do desenvolvedor) deve ser assumida.
* O projeto não deve colidir com portas locais ou serviços pré-existentes.

## 2. Componentes do Docker Compose (docker-compose.yml)

### 2.1 Serviço da Aplicação (app / api)
* Build: Baseado no Dockerfile oficial Bun (oven/bun:1-alpine).
* Porta: Exposta na porta 3000 (ou configurável via .env).
* Dependências: Aguarda postgres e localstack estarem saudáveis (healthcheck).
* Comando: Executa o script de entrypoint (entrypoint.sh).

### 2.2 Banco de Dados (postgres)
* Imagem: postgres:15-alpine.
* Healthcheck: Teste ativo com pg_isready.
* Volume: Persistência nomeada para desenvolvimento local.

### 2.3 AWS SQS Mock (localstack)
* Imagem: localstack/localstack:latest.
* Serviços ativados: SERVICES=sqs.
* Healthcheck: Verificação na porta 4566.

## 3. Automação de Inicialização (entrypoint.sh)

O script de inicialização do contêiner da aplicação deve executar sequencialmente:

1. Aguardar a disponibilidade total do PostgreSQL (via checagem de porta ou pg_isready).
2. Rodar automaticamente todas as migrations do banco de dados (ex: bun run migration:run).
3. Aguardar a inicialização do LocalStack e criar as filas FIFO necessárias (wager-transactions.fifo e wager-transactions-dlq.fifo) via AWS CLI ou script do SDK.
4. Iniciar a aplicação NestJS/Bun em modo de produção/desenvolvimento.

## 4. Requisitos de Execução para o Avaliador

O repositório deve permitir que o avaliador execute apenas os comandos de clonagem e subida dos contêineres e tenha a aplicação totalmente migrada, com as filas SQS criadas e pronta para receber requisições HTTP na porta 3000 e processar mensagens na fila.