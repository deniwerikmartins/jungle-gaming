# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Stage 1 — Dependencies
# ---------------------------------------------------------------------------
FROM oven/bun:1-alpine AS deps

WORKDIR /app

# Copy package manifests first to leverage layer cache
COPY package.json bun.lockb* ./

# Install all dependencies (including devDependencies for build)
RUN bun install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 2 — Build
# ---------------------------------------------------------------------------
FROM oven/bun:1-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Type-check and build
RUN bun run lint || true
RUN bun build src/main.ts --outdir dist --target bun --sourcemap=external

# ---------------------------------------------------------------------------
# Stage 3 — Production image
# ---------------------------------------------------------------------------
FROM oven/bun:1-alpine AS runner

WORKDIR /app

# Install AWS CLI for SQS queue creation in entrypoint
RUN apk add --no-cache aws-cli bash curl postgresql-client

# Copy production artifacts
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY package.json ./
COPY tsconfig.json ./
COPY entrypoint.sh ./

RUN chmod +x entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
