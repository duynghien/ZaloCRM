-- Cleanse empty strings to NULL on contacts
UPDATE "contacts" SET "zalo_uid" = NULL WHERE "zalo_uid" = '' OR TRIM("zalo_uid") = '';

-- Deduplicate existing (org_id, zalo_uid) rows, merging attributes before deletion
WITH ranked_contacts AS (
  SELECT id, org_id, zalo_uid,
         FIRST_VALUE(id) OVER (PARTITION BY org_id, zalo_uid ORDER BY created_at ASC, id ASC) as primary_id,
         ROW_NUMBER() OVER (PARTITION BY org_id, zalo_uid ORDER BY created_at ASC, id ASC) as rn
  FROM contacts
  WHERE zalo_uid IS NOT NULL
),
duplicates AS (
  SELECT c.id, c.primary_id, d.phone, d.email, d.full_name, d.notes
  FROM ranked_contacts c
  JOIN contacts d ON d.id = c.id
  WHERE c.rn > 1
)
UPDATE contacts c
SET
  phone = COALESCE(c.phone, d.phone),
  email = COALESCE(c.email, d.email),
  full_name = CASE WHEN c.full_name = 'Khách Zalo' AND d.full_name != 'Khách Zalo' THEN d.full_name ELSE COALESCE(c.full_name, d.full_name) END,
  notes = COALESCE(c.notes, d.notes)
FROM duplicates d
WHERE c.id = d.primary_id;

WITH ranked_contacts AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY org_id, zalo_uid ORDER BY created_at ASC, id ASC) as rn,
         FIRST_VALUE(id) OVER (PARTITION BY org_id, zalo_uid ORDER BY created_at ASC, id ASC) as primary_id
  FROM contacts
  WHERE zalo_uid IS NOT NULL
),
duplicates AS (
  SELECT id, primary_id FROM ranked_contacts WHERE rn > 1
)
UPDATE conversations c SET contact_id = d.primary_id FROM duplicates d WHERE c.contact_id = d.id;

WITH ranked_contacts AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY org_id, zalo_uid ORDER BY created_at ASC, id ASC) as rn,
         FIRST_VALUE(id) OVER (PARTITION BY org_id, zalo_uid ORDER BY created_at ASC, id ASC) as primary_id
  FROM contacts
  WHERE zalo_uid IS NOT NULL
),
duplicates AS (
  SELECT id, primary_id FROM ranked_contacts WHERE rn > 1
)
UPDATE orders o SET contact_id = d.primary_id FROM duplicates d WHERE o.contact_id = d.id;

WITH ranked_contacts AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY org_id, zalo_uid ORDER BY created_at ASC, id ASC) as rn,
         FIRST_VALUE(id) OVER (PARTITION BY org_id, zalo_uid ORDER BY created_at ASC, id ASC) as primary_id
  FROM contacts
  WHERE zalo_uid IS NOT NULL
),
duplicates AS (
  SELECT id, primary_id FROM ranked_contacts WHERE rn > 1
)
UPDATE appointments a SET contact_id = d.primary_id FROM duplicates d WHERE a.contact_id = d.id;

WITH ranked_contacts AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY org_id, zalo_uid ORDER BY created_at ASC, id ASC) as rn
  FROM contacts
  WHERE zalo_uid IS NOT NULL
)
DELETE FROM contacts WHERE id IN (SELECT id FROM ranked_contacts WHERE rn > 1);

-- CreateIndex
CREATE UNIQUE INDEX "contacts_org_id_zalo_uid_key" ON "contacts"("org_id", "zalo_uid");

-- Create composite unique candidate keys (org_id, id)
CREATE UNIQUE INDEX "contacts_org_id_id_key" ON "contacts"("org_id", "id");
CREATE UNIQUE INDEX "users_org_id_id_key" ON "users"("org_id", "id");
CREATE UNIQUE INDEX "conversations_org_id_id_key" ON "conversations"("org_id", "id");

-- CreateTable
CREATE TABLE "webhook_outbox" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "response_status" INTEGER,
    "last_error" TEXT,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_outbox_status_next_attempt_at_idx" ON "webhook_outbox"("status", "next_attempt_at");
