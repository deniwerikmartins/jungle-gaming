import { Migration } from '@mikro-orm/migrations';

/**
 * Migration: Initial schema — all tables, constraints and indexes.
 *
 * Design decisions:
 * - NUMERIC(20,2) for all monetary columns — exact precision, never float.
 * - CHECK constraint on wallets.balance_amount >= 0 enforced at DB level.
 * - UNIQUE (player_id, currency) on wallets — one wallet per player per currency.
 * - UNIQUE (idempotency_key) on wager_transactions — idempotency enforced at DB level.
 * - UNIQUE (consumer_name, message_id) on inbox_messages — deduplication at DB level.
 * - Composite PK on inbox_messages (consumer_name, message_id).
 * - outbox_messages indexed on (published_at, next_attempt_at) for worker polling.
 * - All timestamps are TIMESTAMPTZ (timezone-aware).
 */
export class Migration20241023000001 extends Migration {
  async up(): Promise<void> {
    // ------------------------------------------------------------------
    // wallets
    // ------------------------------------------------------------------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "wallets" (
        "id"              UUID          NOT NULL,
        "player_id"       UUID          NOT NULL,
        "currency"        VARCHAR(3)    NOT NULL,
        "balance_amount"  NUMERIC(20,2) NOT NULL DEFAULT 0,
        "version"         INTEGER       NOT NULL DEFAULT 0,
        "created_at"      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        "updated_at"      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

        CONSTRAINT "pk_wallets"                        PRIMARY KEY ("id"),
        CONSTRAINT "uq_wallets_player_currency"        UNIQUE ("player_id", "currency"),
        CONSTRAINT "chk_wallets_balance_non_negative"  CHECK ("balance_amount" >= 0)
      );
    `);

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "idx_wallets_player_id"
        ON "wallets" ("player_id");
    `);

    // ------------------------------------------------------------------
    // wallet_ledger_entries
    // ------------------------------------------------------------------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "wallet_ledger_entries" (
        "id"                   UUID          NOT NULL,
        "wallet_id"            UUID          NOT NULL,
        "transaction_id"       UUID          NOT NULL,
        "direction"            VARCHAR(6)    NOT NULL CHECK ("direction" IN ('DEBIT', 'CREDIT')),
        "money_amount"         NUMERIC(20,2) NOT NULL,
        "money_currency"       VARCHAR(3)    NOT NULL,
        "balance_before_amount" NUMERIC(20,2) NOT NULL,
        "balance_after_amount"  NUMERIC(20,2) NOT NULL,
        "created_at"           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

        CONSTRAINT "pk_wallet_ledger_entries" PRIMARY KEY ("id"),
        CONSTRAINT "fk_ledger_wallet"
          FOREIGN KEY ("wallet_id") REFERENCES "wallets" ("id") ON DELETE RESTRICT
      );
    `);

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "idx_ledger_wallet_id"
        ON "wallet_ledger_entries" ("wallet_id");
    `);
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "idx_ledger_transaction_id"
        ON "wallet_ledger_entries" ("transaction_id");
    `);
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "idx_ledger_wallet_created"
        ON "wallet_ledger_entries" ("wallet_id", "created_at" DESC);
    `);

    // ------------------------------------------------------------------
    // wager_transactions
    // ------------------------------------------------------------------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "wager_transactions" (
        "id"                              UUID          NOT NULL,
        "provider_id"                     VARCHAR(255)  NOT NULL,
        "external_transaction_id"         VARCHAR(255)  NOT NULL,
        "idempotency_key"                 VARCHAR(512)  NOT NULL,
        "payload_hash"                    VARCHAR(64)   NOT NULL,
        "wallet_id"                       UUID          NOT NULL,
        "player_id"                       UUID          NOT NULL,
        "round_id"                        VARCHAR(255)  NOT NULL,
        "game_id"                         VARCHAR(255)  NOT NULL,
        "kind"                            VARCHAR(10)   NOT NULL
          CHECK ("kind" IN ('OPENING','BET','WIN','LOSS','REFUND','ROLLBACK')),
        "money_amount"                    NUMERIC(20,2) NOT NULL,
        "money_currency"                  VARCHAR(3)    NOT NULL,
        "reference_external_transaction_id" VARCHAR(255) NULL,
        "reference_transaction_id"        UUID          NULL,
        "status"                          VARCHAR(20)   NOT NULL
          CHECK ("status" IN ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED')),
        "failure_code"                    VARCHAR(80)   NULL,
        "processed_at"                    TIMESTAMPTZ   NULL,
        "created_at"                      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

        CONSTRAINT "pk_wager_transactions"         PRIMARY KEY ("id"),
        CONSTRAINT "uq_wager_idempotency_key"      UNIQUE ("idempotency_key"),
        CONSTRAINT "fk_wager_wallet"
          FOREIGN KEY ("wallet_id") REFERENCES "wallets" ("id") ON DELETE RESTRICT
      );
    `);

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_wager_provider_external"
        ON "wager_transactions" ("provider_id", "external_transaction_id");
    `);
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "idx_wager_wallet_id"
        ON "wager_transactions" ("wallet_id");
    `);
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "idx_wager_player_id"
        ON "wager_transactions" ("player_id");
    `);
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "idx_wager_status"
        ON "wager_transactions" ("status")
        WHERE "status" IN ('PENDING', 'PENDING_REFERENCE');
    `);
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "idx_wager_reference_transaction_id"
        ON "wager_transactions" ("reference_transaction_id")
        WHERE "reference_transaction_id" IS NOT NULL;
    `);

    // ------------------------------------------------------------------
    // inbox_messages — composite PK enforces deduplication at DB level
    // ------------------------------------------------------------------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "inbox_messages" (
        "message_id"    VARCHAR(255) NOT NULL,
        "consumer_name" VARCHAR(255) NOT NULL,
        "payload_hash"  VARCHAR(64)  NOT NULL,
        "received_at"   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        "processed_at"  TIMESTAMPTZ  NULL,

        CONSTRAINT "pk_inbox_messages"
          PRIMARY KEY ("consumer_name", "message_id")
      );
    `);

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "idx_inbox_processed_at"
        ON "inbox_messages" ("processed_at")
        WHERE "processed_at" IS NULL;
    `);

    // ------------------------------------------------------------------
    // outbox_messages — polling index for worker
    // ------------------------------------------------------------------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "outbox_messages" (
        "id"              UUID          NOT NULL,
        "aggregate_id"    UUID          NOT NULL,
        "event_type"      VARCHAR(255)  NOT NULL,
        "payload"         JSONB         NOT NULL,
        "occurred_at"     TIMESTAMPTZ   NOT NULL,
        "attempts"        INTEGER       NOT NULL DEFAULT 0,
        "next_attempt_at" TIMESTAMPTZ   NULL,
        "published_at"    TIMESTAMPTZ   NULL,

        CONSTRAINT "pk_outbox_messages" PRIMARY KEY ("id")
      );
    `);

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "idx_outbox_pending"
        ON "outbox_messages" ("next_attempt_at")
        WHERE "published_at" IS NULL;
    `);
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "idx_outbox_aggregate_id"
        ON "outbox_messages" ("aggregate_id");
    `);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "outbox_messages" CASCADE;`);
    this.addSql(`DROP TABLE IF EXISTS "inbox_messages" CASCADE;`);
    this.addSql(`DROP TABLE IF EXISTS "wager_transactions" CASCADE;`);
    this.addSql(`DROP TABLE IF EXISTS "wallet_ledger_entries" CASCADE;`);
    this.addSql(`DROP TABLE IF EXISTS "wallets" CASCADE;`);
  }
}
