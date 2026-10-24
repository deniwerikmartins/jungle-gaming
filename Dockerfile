# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Jungle Gaming — Distributed Wagering Processor
#
# Single-stage image: Bun transpiles TypeScript on-the-fly at runtime.
# bun build with --target bun does not work well with NestJS optional requires
# (knex dialects, @nestjs/microservices, etc.) — running source directly is
# the correct and officially supported pattern for NestJS + Bun.
# ---------------------------------------------------------------------------
FROM oven/bun:1-alpine

WORKDIR /app

# Install system tools needed by entrypoint.sh
RUN apk add --no-cache aws-cli bash curl postgresql-client

# Install dependencies first (layer cache)
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy application source
COPY . .

RUN chmod +x entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
