-- AlterTable
ALTER TABLE "zalo_accounts" ADD COLUMN IF NOT EXISTS "branch_tag" TEXT;
ALTER TABLE "zalo_accounts" ADD COLUMN IF NOT EXISTS "color_tag" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "conversations_org_id_zalo_account_id_idx" ON "conversations"("org_id", "zalo_account_id");
