-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT,
    "target_role" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "dedup_key" TEXT,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "action_url" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_id_org_id_key" ON "notifications"("id", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_org_id_dedup_key_key" ON "notifications"("org_id", "dedup_key");

-- CreateIndex
CREATE INDEX "notifications_org_id_user_id_is_read_created_at_idx" ON "notifications"("org_id", "user_id", "is_read", "created_at");

-- CreateIndex
CREATE INDEX "notifications_org_id_is_read_created_at_idx" ON "notifications"("org_id", "is_read", "created_at");

-- CreateIndex
CREATE INDEX "notifications_entity_type_entity_id_idx" ON "notifications"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
