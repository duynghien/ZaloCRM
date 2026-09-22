-- CreateTable
CREATE TABLE "cron_job_leases" (
    "lock_id" BIGINT NOT NULL,
    "job_name" TEXT NOT NULL,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cron_job_leases_pkey" PRIMARY KEY ("lock_id")
);

-- Allow output_tokens = 0 when unspent reservation is released on failed attempt
ALTER TABLE "ai_report_budget_reservations" DROP CONSTRAINT IF EXISTS "ai_report_budget_reservations_tokens_check";
ALTER TABLE "ai_report_budget_reservations" ADD CONSTRAINT "ai_report_budget_reservations_tokens_check" CHECK (
  input_tokens >= 0 AND output_tokens >= 0 AND
  (used_input_tokens IS NULL OR used_input_tokens >= 0) AND
  (used_output_tokens IS NULL OR used_output_tokens >= 0)
);
