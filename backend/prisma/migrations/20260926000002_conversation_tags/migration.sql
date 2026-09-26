-- CreateTable
CREATE TABLE IF NOT EXISTS "conversation_tags" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "conversation_tag_assignments" (
    "org_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by_id" TEXT,

    CONSTRAINT "conversation_tag_assignments_pkey" PRIMARY KEY ("conversation_id","tag_id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_tags_org_id_name_key" ON "conversation_tags"("org_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_tags_org_id_id_key" ON "conversation_tags"("org_id", "id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "conversation_tag_assignments_org_id_tag_id_idx" ON "conversation_tag_assignments"("org_id", "tag_id");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversation_tags_org_id_fkey'
  ) THEN
    ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversation_tag_assignments_org_id_fkey'
  ) THEN
    ALTER TABLE "conversation_tag_assignments" ADD CONSTRAINT "conversation_tag_assignments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversation_tag_assignments_org_id_conversation_id_fkey'
  ) THEN
    ALTER TABLE "conversation_tag_assignments" ADD CONSTRAINT "conversation_tag_assignments_org_id_conversation_id_fkey" FOREIGN KEY ("org_id", "conversation_id") REFERENCES "conversations"("org_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversation_tag_assignments_org_id_tag_id_fkey'
  ) THEN
    ALTER TABLE "conversation_tag_assignments" ADD CONSTRAINT "conversation_tag_assignments_org_id_tag_id_fkey" FOREIGN KEY ("org_id", "tag_id") REFERENCES "conversation_tags"("org_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversation_tag_assignments_assigned_by_id_fkey'
  ) THEN
    ALTER TABLE "conversation_tag_assignments" ADD CONSTRAINT "conversation_tag_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
