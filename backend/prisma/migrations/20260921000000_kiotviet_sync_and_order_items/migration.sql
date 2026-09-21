-- AlterTable orders
ALTER TABLE "orders" ADD COLUMN "paid_amount" DECIMAL(18,0),
ADD COLUMN "payment_method" TEXT,
ADD COLUMN "payment_account_id" BIGINT,
ADD COLUMN "payment_recorded_at" TIMESTAMP(3),
ADD COLUMN "kiotviet_customer_id" BIGINT,
ADD COLUMN "kiotviet_invoice_id" BIGINT,
ADD COLUMN "kiotviet_invoice_code" TEXT,
ADD COLUMN "kiotviet_sync_status" TEXT NOT NULL DEFAULT 'not_synced',
ADD COLUMN "kiotviet_sync_error" TEXT,
ADD COLUMN "kiotviet_synced_at" TIMESTAMP(3),
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "orders_org_id_id_key" ON "orders"("org_id", "id");

-- CreateTable order_items
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT,
    "kiotviet_product_id" BIGINT NOT NULL,
    "retailer" TEXT NOT NULL,
    "branch_id" BIGINT NOT NULL,
    "product_code" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "unit" TEXT,
    "quantity" DECIMAL(18,3) NOT NULL,
    "price" DECIMAL(18,4) NOT NULL,
    "discount_mode" TEXT NOT NULL DEFAULT 'amount',
    "discount_input" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(18,0) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable kiotviet_products
CREATE TABLE "kiotviet_products" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "retailer" TEXT NOT NULL,
    "branch_id" BIGINT NOT NULL,
    "kiotviet_id" BIGINT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "price" DECIMAL(18,4) NOT NULL,
    "on_hand" DECIMAL(18,3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "allows_sale" BOOLEAN NOT NULL DEFAULT true,
    "product_type" TEXT NOT NULL DEFAULT 'normal',
    "has_variants" BOOLEAN NOT NULL DEFAULT false,
    "has_serial" BOOLEAN NOT NULL DEFAULT false,
    "has_batch" BOOLEAN NOT NULL DEFAULT false,
    "is_master" BOOLEAN NOT NULL DEFAULT false,
    "source_modified_at" TIMESTAMP(3),
    "last_seen_run_id" TEXT,
    "stock_checked_at" TIMESTAMP(3),
    "raw_attributes" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kiotviet_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable kiotviet_sync_states
CREATE TABLE "kiotviet_sync_states" (
    "org_id" TEXT NOT NULL,
    "config_revision" INTEGER NOT NULL DEFAULT 0,
    "retailer" TEXT,
    "branch_id" BIGINT,
    "catalog_cursor" TIMESTAMP(3),
    "catalog_ready" BOOLEAN NOT NULL DEFAULT false,
    "last_successful_at" TIMESTAMP(3),
    "last_successful_run_id" TEXT,
    "run_id" TEXT,
    "run_mode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "processed_count" INTEGER NOT NULL DEFAULT 0,
    "total_products" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "lease_version" INTEGER NOT NULL DEFAULT 0,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kiotviet_sync_states_pkey" PRIMARY KEY ("org_id")
);

-- CreateTable kiotviet_rate_limit_buckets
CREATE TABLE "kiotviet_rate_limit_buckets" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "retailer" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "blocked_until" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kiotviet_rate_limit_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateTable kiotviet_retailer_leases
CREATE TABLE "kiotviet_retailer_leases" (
    "org_id" TEXT NOT NULL,
    "retailer" TEXT NOT NULL,
    "lease_owner" TEXT,
    "lease_version" INTEGER NOT NULL DEFAULT 0,
    "lease_expires_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kiotviet_retailer_leases_pkey" PRIMARY KEY ("org_id","retailer")
);

-- CreateTable kiotviet_invoice_jobs
CREATE TABLE "kiotviet_invoice_jobs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "order_revision" INTEGER NOT NULL,
    "config_revision" INTEGER NOT NULL,
    "retailer" TEXT NOT NULL,
    "branch_id" BIGINT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshot_hash" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "lease_owner" TEXT,
    "lease_version" INTEGER NOT NULL DEFAULT 0,
    "lease_expires_at" TIMESTAMP(3),
    "request_started_at" TIMESTAMP(3),
    "remote_invoice_id" BIGINT,
    "remote_invoice_code" TEXT,
    "remote_snapshot" JSONB,
    "reconciliation_status" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "reconciled_at" TIMESTAMP(3),
    "reconciled_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kiotviet_invoice_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_items_org_id_order_id_idx" ON "order_items"("org_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "kiotviet_products_org_id_retailer_branch_id_kiotviet_id_key" ON "kiotviet_products"("org_id", "retailer", "branch_id", "kiotviet_id");
CREATE INDEX "kiotviet_products_org_id_retailer_branch_id_is_active_idx" ON "kiotviet_products"("org_id", "retailer", "branch_id", "is_active");
CREATE INDEX "kiotviet_products_org_id_retailer_code_idx" ON "kiotviet_products"("org_id", "retailer", "code");
CREATE INDEX "kiotviet_products_org_id_retailer_name_idx" ON "kiotviet_products"("org_id", "retailer", "name");

-- CreateIndex
CREATE UNIQUE INDEX "kiotviet_rate_limit_buckets_org_id_retailer_window_start_key" ON "kiotviet_rate_limit_buckets"("org_id", "retailer", "window_start");

-- CreateIndex
CREATE UNIQUE INDEX "kiotviet_invoice_jobs_org_id_order_id_key" ON "kiotviet_invoice_jobs"("org_id", "order_id");
CREATE UNIQUE INDEX "kiotviet_invoice_jobs_retailer_remote_invoice_id_key" ON "kiotviet_invoice_jobs"("retailer", "remote_invoice_id");
CREATE INDEX "kiotviet_invoice_jobs_state_next_attempt_at_lease_expires_at_idx" ON "kiotviet_invoice_jobs"("state", "next_attempt_at", "lease_expires_at");
CREATE INDEX "kiotviet_invoice_jobs_org_id_state_idx" ON "kiotviet_invoice_jobs"("org_id", "state");

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_org_id_order_id_fkey" FOREIGN KEY ("org_id", "order_id") REFERENCES "orders"("org_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiotviet_products" ADD CONSTRAINT "kiotviet_products_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiotviet_sync_states" ADD CONSTRAINT "kiotviet_sync_states_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiotviet_rate_limit_buckets" ADD CONSTRAINT "kiotviet_rate_limit_buckets_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiotviet_retailer_leases" ADD CONSTRAINT "kiotviet_retailer_leases_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiotviet_invoice_jobs" ADD CONSTRAINT "kiotviet_invoice_jobs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kiotviet_invoice_jobs" ADD CONSTRAINT "kiotviet_invoice_jobs_org_id_order_id_fkey" FOREIGN KEY ("org_id", "order_id") REFERENCES "orders"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
