-- CreateTable
CREATE TABLE IF NOT EXISTS "cron_job_lease_resets" (
    "id" TEXT NOT NULL,
    "lock_id" BIGINT NOT NULL,
    "job_name" TEXT NOT NULL,
    "prior_owner" TEXT,
    "prior_expires_at" TIMESTAMP(3),
    "actor" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cron_job_lease_resets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cron_job_lease_resets_lock_id_idx" ON "cron_job_lease_resets"("lock_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cron_job_lease_resets_actor_idx" ON "cron_job_lease_resets"("actor");
