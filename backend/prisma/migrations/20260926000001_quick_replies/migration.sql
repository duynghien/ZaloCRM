-- CreateTable
CREATE TABLE IF NOT EXISTS "quick_replies" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "shortcut" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quick_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "quick_replies_org_id_shortcut_key" ON "quick_replies"("org_id", "shortcut");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "quick_replies_org_id_category_idx" ON "quick_replies"("org_id", "category");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quick_replies_org_id_fkey'
  ) THEN
    ALTER TABLE "quick_replies" ADD CONSTRAINT "quick_replies_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quick_replies_created_by_id_fkey'
  ) THEN
    ALTER TABLE "quick_replies" ADD CONSTRAINT "quick_replies_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
