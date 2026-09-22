-- CreateTable
CREATE TABLE "kiotviet_vendor_cooldown" (
    "org_id" TEXT NOT NULL,
    "retailer" TEXT NOT NULL,
    "blocked_until" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kiotviet_vendor_cooldown_pkey" PRIMARY KEY ("org_id","retailer")
);

-- CreateTable
CREATE TABLE "attachment_download_jobs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "attachment_index" INTEGER NOT NULL,
    "remote_url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachment_download_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attachment_download_jobs_message_id_attachment_index_key" ON "attachment_download_jobs"("message_id", "attachment_index");

-- CreateIndex
CREATE INDEX "attachment_download_jobs_status_next_attempt_at_idx" ON "attachment_download_jobs"("status", "next_attempt_at");
