-- CreateTable
CREATE TABLE "zalo_account_rate_state" (
    "account_id" TEXT NOT NULL,
    "date_vn" VARCHAR(10) NOT NULL,
    "daily_count" INTEGER NOT NULL DEFAULT 0,
    "last_send_at" TIMESTAMP(3),
    "recent_sends" TIMESTAMP(3)[] DEFAULT ARRAY[]::TIMESTAMP(3)[],
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zalo_account_rate_state_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "zalo_outbound_messages" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "message_id" TEXT,
    "idempotency_key" TEXT,
    "content" TEXT,
    "attachments" JSONB,
    "state" TEXT NOT NULL DEFAULT 'preparing',
    "remote_msg_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zalo_outbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zalo_outbound_messages_org_id_account_id_thread_id_idempotenc_key" ON "zalo_outbound_messages"("org_id", "account_id", "thread_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "zalo_outbound_messages_org_id_account_id_state_idx" ON "zalo_outbound_messages"("org_id", "account_id", "state");

-- AddForeignKey
ALTER TABLE "zalo_account_rate_state" ADD CONSTRAINT "zalo_account_rate_state_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "zalo_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zalo_outbound_messages" ADD CONSTRAINT "zalo_outbound_messages_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zalo_outbound_messages" ADD CONSTRAINT "zalo_outbound_messages_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "zalo_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
