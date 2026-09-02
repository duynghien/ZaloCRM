CREATE TABLE "ai_report_jobs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "created_by_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "schedule_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "request_data" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "cancellation_requested_at" TIMESTAMP(3),
    "result_report_id" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_report_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_report_job_dispatches" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "claimed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_report_job_dispatches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_report_jobs_result_report_id_key" ON "ai_report_jobs"("result_report_id");
CREATE UNIQUE INDEX "ai_report_jobs_org_id_created_by_id_idempotency_key_key" ON "ai_report_jobs"("org_id", "created_by_id", "idempotency_key");
CREATE UNIQUE INDEX "ai_report_jobs_schedule_key_key" ON "ai_report_jobs"("schedule_key");
CREATE INDEX "ai_report_jobs_status_lease_expires_at_idx" ON "ai_report_jobs"("status", "lease_expires_at");
CREATE INDEX "ai_report_jobs_org_id_status_idx" ON "ai_report_jobs"("org_id", "status");
CREATE UNIQUE INDEX "ai_report_job_dispatches_job_id_channel_key" ON "ai_report_job_dispatches"("job_id", "channel");

ALTER TABLE "ai_report_jobs" ADD CONSTRAINT "ai_report_jobs_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_report_jobs" ADD CONSTRAINT "ai_report_jobs_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_report_jobs" ADD CONSTRAINT "ai_report_jobs_result_report_id_fkey"
  FOREIGN KEY ("result_report_id") REFERENCES "generated_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_report_job_dispatches" ADD CONSTRAINT "ai_report_job_dispatches_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "ai_report_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
