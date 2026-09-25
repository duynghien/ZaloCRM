-- CreateTable
CREATE TABLE "ai_knowledge_rules" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'org',
    "branch_tag" TEXT,
    "group_thread_id" TEXT,
    "zalo_account_id" TEXT,
    "category" TEXT NOT NULL DEFAULT 'general',
    "title" TEXT NOT NULL,
    "rule_content" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "source_report_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_knowledge_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_report_feedbacks" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "section_key" TEXT NOT NULL DEFAULT 'general',
    "original_snippet" TEXT NOT NULL,
    "feedback_comment" TEXT NOT NULL,
    "target_scope" TEXT NOT NULL DEFAULT 'group',
    "branch_tag" TEXT,
    "group_thread_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "distilled_rule_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_report_feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_knowledge_rules_org_id_id_key" ON "ai_knowledge_rules"("org_id", "id");

-- CreateIndex
CREATE INDEX "ai_knowledge_rules_org_id_scope_is_active_idx" ON "ai_knowledge_rules"("org_id", "scope", "is_active");

-- CreateIndex
CREATE INDEX "ai_knowledge_rules_org_id_group_thread_id_is_active_idx" ON "ai_knowledge_rules"("org_id", "group_thread_id", "is_active");

-- CreateIndex
CREATE INDEX "ai_knowledge_rules_org_id_branch_tag_is_active_idx" ON "ai_knowledge_rules"("org_id", "branch_tag", "is_active");

-- CreateIndex
CREATE INDEX "ai_report_feedbacks_org_id_report_id_idx" ON "ai_report_feedbacks"("org_id", "report_id");

-- CreateIndex
CREATE INDEX "ai_report_feedbacks_org_id_status_idx" ON "ai_report_feedbacks"("org_id", "status");

-- AddForeignKey
ALTER TABLE "ai_knowledge_rules" ADD CONSTRAINT "ai_knowledge_rules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_knowledge_rules" ADD CONSTRAINT "ai_knowledge_rules_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_knowledge_rules" ADD CONSTRAINT "ai_knowledge_rules_source_report_id_fkey" FOREIGN KEY ("source_report_id") REFERENCES "generated_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_report_feedbacks" ADD CONSTRAINT "ai_report_feedbacks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_report_feedbacks" ADD CONSTRAINT "ai_report_feedbacks_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "generated_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_report_feedbacks" ADD CONSTRAINT "ai_report_feedbacks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_report_feedbacks" ADD CONSTRAINT "ai_report_feedbacks_distilled_rule_id_fkey" FOREIGN KEY ("distilled_rule_id") REFERENCES "ai_knowledge_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
