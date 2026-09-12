-- Run only after every old producer/worker/send has drained. Atomic DDL and
-- conversion permit retry after interruption; Prisma tracks completed migrations.
BEGIN;

-- DropIndex
DROP INDEX "group_report_configs_org_id_group_thread_id_key";

-- AlterTable
ALTER TABLE "group_report_configs" ADD COLUMN     "legacy_target_data" JSONB,
ADD COLUMN     "target_resolution_status" TEXT NOT NULL DEFAULT 'resolved';

-- AlterTable
ALTER TABLE "generated_reports" ADD COLUMN     "source_targets" JSONB,
ADD COLUMN     "target_resolution_status" TEXT NOT NULL DEFAULT 'legacy_unverified',
ADD COLUMN     "target_schema_version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ai_report_job_dispatches" ADD COLUMN     "delivery_uncertain" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sent_parts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "total_parts" INTEGER;

-- CreateTable
CREATE TABLE "ai_report_budget_reservations" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "attempt_key" TEXT NOT NULL,
    "lease_owner" TEXT NOT NULL,
    "lease_expires_at" TIMESTAMP(3) NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "used_input_tokens" INTEGER,
    "used_output_tokens" INTEGER,
    "outcome" TEXT NOT NULL DEFAULT 'reserved',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_report_budget_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_report_resends" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "requested_by_id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_data" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_report_resends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_report_resend_dispatches" (
    "id" TEXT NOT NULL,
    "resend_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "claimed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "sent_parts" INTEGER NOT NULL DEFAULT 0,
    "total_parts" INTEGER,
    "delivery_uncertain" BOOLEAN NOT NULL DEFAULT false,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_report_resend_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_report_budget_reservations_job_id_attempt_key_key" ON "ai_report_budget_reservations"("job_id", "attempt_key");

-- CreateIndex
CREATE INDEX "ai_report_resends_org_id_report_id_idx" ON "ai_report_resends"("org_id", "report_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_report_resends_org_id_requested_by_id_idempotency_key_key" ON "ai_report_resends"("org_id", "requested_by_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "ai_report_resend_dispatches_resend_id_channel_key" ON "ai_report_resend_dispatches"("resend_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "group_report_configs_org_id_zalo_account_id_group_thread_id_key" ON "group_report_configs"("org_id", "zalo_account_id", "group_thread_id");

-- AddForeignKey
ALTER TABLE "ai_report_budget_reservations" ADD CONSTRAINT "ai_report_budget_reservations_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ai_report_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_report_resends" ADD CONSTRAINT "ai_report_resends_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_report_resends" ADD CONSTRAINT "ai_report_resends_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "generated_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_report_resend_dispatches" ADD CONSTRAINT "ai_report_resend_dispatches_resend_id_fkey" FOREIGN KEY ("resend_id") REFERENCES "ai_report_resends"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve original configuration identity and values before resolving future use.
-- Report provenance is intentionally never inferred from current conversations.
WITH candidates AS (
  SELECT cfg.id, count(c.id) AS candidate_count, min(c.zalo_account_id) AS candidate_account,
    bool_or(c.zalo_account_id = cfg.zalo_account_id) AS explicit_valid
  FROM group_report_configs cfg
  LEFT JOIN conversations c ON c.org_id = cfg.org_id
    AND c.external_thread_id = cfg.group_thread_id AND c."threadType" = 'group'
    AND EXISTS (SELECT 1 FROM zalo_accounts a WHERE a.id = c.zalo_account_id AND a.org_id = cfg.org_id)
  GROUP BY cfg.id
), classified AS (
  SELECT cfg.id,
    CASE
      WHEN cfg.zalo_account_id IS NOT NULL AND candidates.explicit_valid THEN 'explicit_valid'
      WHEN cfg.zalo_account_id IS NOT NULL THEN 'explicit_invalid'
      WHEN candidates.candidate_count = 1 THEN 'null_unique'
      WHEN candidates.candidate_count = 0 THEN 'null_missing'
      ELSE 'null_ambiguous'
    END AS reason,
    candidates.candidate_account
  FROM group_report_configs cfg JOIN candidates ON candidates.id = cfg.id
)
UPDATE group_report_configs cfg SET
  legacy_target_data = jsonb_build_object(
    'zaloAccountId', cfg.zalo_account_id, 'groupThreadId', cfg.group_thread_id,
    'isEnabled', cfg.is_enabled, 'resolutionReason', classified.reason),
  target_resolution_status = CASE WHEN classified.reason IN ('explicit_valid', 'null_unique')
    THEN 'resolved' ELSE 'needs_resolution' END,
  zalo_account_id = CASE WHEN classified.reason = 'explicit_valid' THEN cfg.zalo_account_id
    WHEN classified.reason = 'null_unique' THEN classified.candidate_account ELSE NULL END,
  is_enabled = CASE WHEN classified.reason IN ('explicit_valid', 'null_unique') THEN cfg.is_enabled ELSE false END
FROM classified WHERE classified.id = cfg.id;

ALTER TABLE group_report_configs ADD CONSTRAINT group_report_configs_resolution_check CHECK (
  (target_resolution_status = 'resolved' AND zalo_account_id IS NOT NULL) OR
  (target_resolution_status = 'needs_resolution' AND zalo_account_id IS NULL AND is_enabled = false)
);

ALTER TABLE generated_reports ADD CONSTRAINT generated_reports_targets_check CHECK (
  (target_resolution_status = 'legacy_unverified' AND target_schema_version = 1 AND source_targets IS NULL) OR
  (target_resolution_status = 'verified' AND target_schema_version = 2 AND source_targets IS NOT NULL
    AND CASE WHEN jsonb_typeof(source_targets) = 'array' THEN jsonb_array_length(source_targets) > 0 ELSE false END)
);

-- Preserve original JSON, keys, result, cancellation intent and all dispatch states.
UPDATE ai_report_jobs SET status = 'failed',
  error_message = 'legacy_report_targets_require_resubmission',
  finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
  lease_owner = NULL, lease_expires_at = NULL
WHERE status NOT IN ('succeeded', 'failed', 'cancelled')
  AND (request_data -> 'schemaVersion') IS DISTINCT FROM '2'::jsonb;

ALTER TABLE ai_report_budget_reservations ADD CONSTRAINT ai_report_budget_reservations_tokens_check CHECK (
  input_tokens >= 0 AND output_tokens > 0 AND
  (used_input_tokens IS NULL OR used_input_tokens >= 0) AND
  (used_output_tokens IS NULL OR used_output_tokens >= 0)
);
ALTER TABLE ai_report_job_dispatches ADD CONSTRAINT ai_report_job_dispatches_parts_check CHECK (
  sent_parts >= 0 AND (total_parts IS NULL OR total_parts >= sent_parts)
);
ALTER TABLE ai_report_resend_dispatches ADD CONSTRAINT ai_report_resend_dispatches_parts_check CHECK (
  sent_parts >= 0 AND (total_parts IS NULL OR total_parts >= sent_parts)
);

COMMIT;
