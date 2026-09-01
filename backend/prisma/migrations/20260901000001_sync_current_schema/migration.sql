-- CreateTable
CREATE TABLE "group_report_configs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "group_thread_id" TEXT NOT NULL,
    "group_name" TEXT,
    "zalo_account_id" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "custom_prompt" TEXT,
    "focus_keywords" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_report_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_reports" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "created_by_id" TEXT,
    "title" TEXT NOT NULL,
    "reportType" TEXT NOT NULL DEFAULT 'on_demand',
    "period_from" TIMESTAMP(3) NOT NULL,
    "period_to" TIMESTAMP(3) NOT NULL,
    "group_thread_ids" JSONB NOT NULL DEFAULT '[]',
    "summary_content" TEXT NOT NULL,
    "structured_data" JSONB NOT NULL DEFAULT '{}',
    "sent_zalo" BOOLEAN NOT NULL DEFAULT false,
    "sent_email" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "group_report_configs_org_id_group_thread_id_key" ON "group_report_configs"("org_id", "group_thread_id");

-- CreateIndex
CREATE INDEX "generated_reports_org_id_created_at_idx" ON "generated_reports"("org_id", "created_at");

-- AddForeignKey
ALTER TABLE "group_report_configs" ADD CONSTRAINT "group_report_configs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_reports" ADD CONSTRAINT "generated_reports_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_reports" ADD CONSTRAINT "generated_reports_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
