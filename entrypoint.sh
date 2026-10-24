#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# entrypoint.sh — Jungle Gaming Wagering Processor
# Executed inside the application container on startup.
# ---------------------------------------------------------------------------

POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-wagering}"
POSTGRES_USER="${POSTGRES_USER:-wagering}"

LOCALSTACK_HOST="${LOCALSTACK_HOST:-localstack}"
LOCALSTACK_PORT="${LOCALSTACK_PORT:-4566}"
AWS_REGION="${AWS_REGION:-us-east-1}"

SQS_QUEUE_NAME="wager-transactions.fifo"
SQS_DLQ_NAME="wager-transactions-dlq.fifo"

# ---------------------------------------------------------------------------
# 1. Wait for PostgreSQL to be ready
# ---------------------------------------------------------------------------
echo "[entrypoint] Waiting for PostgreSQL at ${POSTGRES_HOST}:${POSTGRES_PORT}..."
until pg_isready -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -q; do
  echo "[entrypoint] PostgreSQL not ready yet, retrying in 2s..."
  sleep 2
done
echo "[entrypoint] PostgreSQL is ready."

# ---------------------------------------------------------------------------
# 2. Run database migrations
# ---------------------------------------------------------------------------
echo "[entrypoint] Running database migrations..."
bun run migration:run
echo "[entrypoint] Migrations completed."

# ---------------------------------------------------------------------------
# 3. Wait for LocalStack SQS to be ready
# ---------------------------------------------------------------------------
echo "[entrypoint] Waiting for LocalStack at ${LOCALSTACK_HOST}:${LOCALSTACK_PORT}..."
until curl -sf "http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT}/_localstack/health" | grep -q '"sqs": "available"'; do
  echo "[entrypoint] LocalStack SQS not ready yet, retrying in 2s..."
  sleep 2
done
echo "[entrypoint] LocalStack is ready."

# ---------------------------------------------------------------------------
# 4. Create SQS FIFO queues (idempotent — aws sqs create-queue is idempotent)
# ---------------------------------------------------------------------------
echo "[entrypoint] Creating SQS FIFO queues..."

# DLQ first (main queue references it)
aws sqs create-queue \
  --queue-name "${SQS_DLQ_NAME}" \
  --attributes FifoQueue=true,ContentBasedDeduplication=true \
  --region "${AWS_REGION}" \
  --endpoint-url "http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT}" \
  > /dev/null

# Retrieve DLQ ARN
DLQ_URL=$(aws sqs get-queue-url \
  --queue-name "${SQS_DLQ_NAME}" \
  --region "${AWS_REGION}" \
  --endpoint-url "http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT}" \
  --query 'QueueUrl' --output text)

DLQ_ARN=$(aws sqs get-queue-attributes \
  --queue-url "${DLQ_URL}" \
  --attribute-names QueueArn \
  --region "${AWS_REGION}" \
  --endpoint-url "http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT}" \
  --query 'Attributes.QueueArn' --output text)

# Main FIFO queue with redrive policy pointing to DLQ
REDRIVE_POLICY="{\"deadLetterTargetArn\":\"${DLQ_ARN}\",\"maxReceiveCount\":\"5\"}"

aws sqs create-queue \
  --queue-name "${SQS_QUEUE_NAME}" \
  --attributes "FifoQueue=true,ContentBasedDeduplication=true,RedrivePolicy=${REDRIVE_POLICY}" \
  --region "${AWS_REGION}" \
  --endpoint-url "http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT}" \
  > /dev/null

echo "[entrypoint] SQS queues created: ${SQS_QUEUE_NAME}, ${SQS_DLQ_NAME}"

# ---------------------------------------------------------------------------
# 5. Start the NestJS application
# ---------------------------------------------------------------------------
echo "[entrypoint] Starting Jungle Gaming Wagering Processor..."
exec bun run src/main.ts
