-- CreateTable: api_keys
CREATE TABLE IF NOT EXISTS "api_keys" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "key_prefix" VARCHAR(16) NOT NULL,
    "key_hash" VARCHAR(64) NOT NULL,
    "scopes" JSONB NOT NULL DEFAULT '["contacts:read","orders:read"]'::jsonb,
    "rate_limit" INTEGER NOT NULL DEFAULT 60,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "revoked_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable: api_key_rate_limit_buckets
CREATE TABLE IF NOT EXISTS "api_key_rate_limit_buckets" (
    "key_id" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "request_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "api_key_rate_limit_buckets_pkey" PRIMARY KEY ("key_id","window_start")
);

-- CreateTable: webhook_subscriptions
CREATE TABLE IF NOT EXISTS "webhook_subscriptions" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "target_url" VARCHAR(1000) NOT NULL,
    "secret_encrypted" BYTEA,
    "events" JSONB NOT NULL DEFAULT '["*"]'::jsonb,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "pause_reason" TEXT,
    "deleted_at" TIMESTAMP(3),
    "send_v1_signature" BOOLEAN NOT NULL DEFAULT true,
    "consecutive_fails" INTEGER NOT NULL DEFAULT 0,
    "last_dispatched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

-- AlterTable: webhook_outbox
ALTER TABLE "webhook_outbox" ADD COLUMN IF NOT EXISTS "subscription_id" TEXT;
ALTER TABLE "webhook_outbox" ADD COLUMN IF NOT EXISTS "destination_url" TEXT;
ALTER TABLE "webhook_outbox" ADD COLUMN IF NOT EXISTS "signing_secret_encrypted" BYTEA;
ALTER TABLE "webhook_outbox" ADD COLUMN IF NOT EXISTS "send_v1_signature_snapshot" BOOLEAN;

-- AlterTable: orders
ALTER TABLE "orders" ALTER COLUMN "created_by_user_id" DROP NOT NULL;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "created_by_key_id" TEXT;

-- AlterTable: order_items
ALTER TABLE "order_items" ALTER COLUMN "kiotviet_product_id" DROP NOT NULL;
ALTER TABLE "order_items" ALTER COLUMN "retailer" DROP NOT NULL;
ALTER TABLE "order_items" ALTER COLUMN "branch_id" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_key_hash_key" ON "api_keys"("key_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_org_id_id_key" ON "api_keys"("org_id", "id");
CREATE INDEX IF NOT EXISTS "api_keys_org_id_is_active_idx" ON "api_keys"("org_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_subscriptions_org_id_id_key" ON "webhook_subscriptions"("org_id", "id");
CREATE INDEX IF NOT EXISTS "webhook_subscriptions_org_id_is_active_idx" ON "webhook_subscriptions"("org_id", "is_active");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "webhook_outbox_org_id_created_at_idx" ON "webhook_outbox"("org_id", "created_at" DESC);

-- AddForeignKey: api_keys -> organizations
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_org_id_fkey'
  ) THEN
    ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey: api_keys -> users (composite tenant safe)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_org_id_created_by_id_fkey'
  ) THEN
    ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_org_id_created_by_id_fkey" FOREIGN KEY ("org_id", "created_by_id") REFERENCES "users"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey: api_key_rate_limit_buckets -> api_keys
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'api_key_rate_limit_buckets_key_id_fkey'
  ) THEN
    ALTER TABLE "api_key_rate_limit_buckets" ADD CONSTRAINT "api_key_rate_limit_buckets_key_id_fkey" FOREIGN KEY ("key_id") REFERENCES "api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey: webhook_subscriptions -> organizations
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'webhook_subscriptions_org_id_fkey'
  ) THEN
    ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey: webhook_outbox -> webhook_subscriptions (composite tenant safe)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'webhook_outbox_org_id_subscription_id_fkey'
  ) THEN
    ALTER TABLE "webhook_outbox" ADD CONSTRAINT "webhook_outbox_org_id_subscription_id_fkey" FOREIGN KEY ("org_id", "subscription_id") REFERENCES "webhook_subscriptions"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey: orders -> api_keys (composite tenant safe)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_created_by_key_fkey'
  ) THEN
    ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_key_fkey" FOREIGN KEY ("org_id", "created_by_key_id") REFERENCES "api_keys"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
