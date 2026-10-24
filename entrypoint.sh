#!/usr/bin/env bash
set -euo pipefail

POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-wagering}"
POSTGRES_USER="${POSTGRES_USER:-wagering}"

LOCALSTACK_HOST="${LOCALSTACK_HOST:-localstack}"
LOCALSTACK_PORT="${LOCALSTACK_PORT:-4566}"
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ENDPOINT="http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT}"

SQS_QUEUE_NAME="wager-transactions.fifo"
SQS_DLQ_NAME="wager-transactions-dlq.fifo"
SQS_EVENTS_NAME="wager-events.fifo"

wait_tcp() {
  local host="$1" port="$2" label="$3"
  local retries=0 max=30
  echo "[entrypoint] Waiting for ${label} at ${host}:${port}..."
  until (bash -c ">/dev/tcp/${host}/${port}" 2>/dev/null); do
    retries=$((retries + 1))
    [ "$retries" -ge "$max" ] && echo "[entrypoint] ERROR: ${label} timed out." && exit 1
    echo "[entrypoint] ${label} not ready (${retries}/${max}), retrying in 2s..."
    sleep 2
  done
  echo "[entrypoint] ${label} is reachable."
}

# ---------------------------------------------------------------------------
# 1. PostgreSQL
# ---------------------------------------------------------------------------
wait_tcp "${POSTGRES_HOST}" "${POSTGRES_PORT}" "PostgreSQL"
until pg_isready -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -q 2>/dev/null; do
  sleep 1
done
echo "[entrypoint] PostgreSQL ready."

# ---------------------------------------------------------------------------
# 2. Migrations
# ---------------------------------------------------------------------------
echo "[entrypoint] Running migrations..."
bun run migration:run
echo "[entrypoint] Migrations done."

# ---------------------------------------------------------------------------
# 3. LocalStack
# ---------------------------------------------------------------------------
wait_tcp "${LOCALSTACK_HOST}" "${LOCALSTACK_PORT}" "LocalStack"
retries=0
until curl -sf "${AWS_ENDPOINT}/_localstack/health" 2>/dev/null | grep -qE '"sqs"'; do
  retries=$((retries + 1))
  [ "$retries" -ge 20 ] && echo "[entrypoint] ERROR: LocalStack SQS timed out." && exit 1
  sleep 2
done
echo "[entrypoint] LocalStack SQS ready."

# ---------------------------------------------------------------------------
# 4. Create SQS queues
# ---------------------------------------------------------------------------
echo "[entrypoint] Creating SQS queues..."

# Create DLQ — capture URL from response
DLQ_URL=$(aws sqs create-queue \
  --queue-name "${SQS_DLQ_NAME}" \
  --attributes FifoQueue=true,ContentBasedDeduplication=true \
  --region "${AWS_REGION}" \
  --endpoint-url "${AWS_ENDPOINT}" \
  --query 'QueueUrl' --output text)

echo "[entrypoint] DLQ URL: ${DLQ_URL}"

# Get DLQ ARN
DLQ_ARN=$(aws sqs get-queue-attributes \
  --queue-url "${DLQ_URL}" \
  --attribute-names QueueArn \
  --region "${AWS_REGION}" \
  --endpoint-url "${AWS_ENDPOINT}" \
  --query 'Attributes.QueueArn' --output text)

echo "[entrypoint] DLQ ARN: ${DLQ_ARN}"

# Write RedrivePolicy to a temp file to avoid shell quoting issues
REDRIVE_JSON_FILE="$(mktemp)"
cat > "${REDRIVE_JSON_FILE}" <<EOF
{
  "FifoQueue": "true",
  "ContentBasedDeduplication": "true",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"${DLQ_ARN}\",\"maxReceiveCount\":\"5\"}"
}
EOF

# Create main FIFO queue
QUEUE_URL=$(aws sqs create-queue \
  --queue-name "${SQS_QUEUE_NAME}" \
  --attributes "file://${REDRIVE_JSON_FILE}" \
  --region "${AWS_REGION}" \
  --endpoint-url "${AWS_ENDPOINT}" \
  --query 'QueueUrl' --output text)

rm -f "${REDRIVE_JSON_FILE}"

echo "[entrypoint] Queue URL: ${QUEUE_URL}"

# Export real URLs for the application
export SQS_QUEUE_URL="${QUEUE_URL}"
export SQS_DLQ_URL="${DLQ_URL}"

# Create events output queue (Outbox publishes here — separate from input queue)
EVENTS_URL=$(aws sqs create-queue \
  --queue-name "${SQS_EVENTS_NAME}" \
  --attributes FifoQueue=true,ContentBasedDeduplication=true \
  --region "${AWS_REGION}" \
  --endpoint-url "${AWS_ENDPOINT}" \
  --query 'QueueUrl' --output text)

echo "[entrypoint] Events queue URL: ${EVENTS_URL}"
export SQS_EVENTS_URL="${EVENTS_URL}"

# ---------------------------------------------------------------------------
# 5. Start app
# ---------------------------------------------------------------------------
echo "[entrypoint] Starting Wagering Processor..."
exec bun run src/main.ts
