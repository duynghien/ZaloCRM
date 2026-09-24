-- Cleanse empty strings to NULL on contacts
UPDATE "contacts" SET "zalo_uid" = NULL WHERE "zalo_uid" = '' OR TRIM("zalo_uid") = '';

-- 1. Create temporary deduplication mapping with deterministic ordering
DROP TABLE IF EXISTS contact_dedupe_map;
CREATE TEMP TABLE contact_dedupe_map AS
WITH ranked AS (
  SELECT
    id AS contact_id,
    FIRST_VALUE(id) OVER (
      PARTITION BY org_id, zalo_uid
      ORDER BY updated_at DESC, created_at DESC, id ASC
    ) AS survivor_id,
    ROW_NUMBER() OVER (
      PARTITION BY org_id, zalo_uid
      ORDER BY updated_at DESC, created_at DESC, id ASC
    ) AS rank
  FROM contacts
  WHERE zalo_uid IS NOT NULL
)
SELECT contact_id, survivor_id, rank FROM ranked;

-- 2. Merge non-null scalar attributes into the survivor from duplicates (ordered by updated_at DESC, created_at DESC, id ASC)
WITH ranked_attributes AS (
  SELECT
    m.survivor_id,
    c.phone,
    c.email,
    c.full_name,
    c.avatar_url,
    c.source,
    c.source_date,
    c.first_contact_date,
    c.status,
    c.next_appointment,
    c.assigned_user_id,
    c.notes,
    ROW_NUMBER() OVER (
      PARTITION BY m.survivor_id
      ORDER BY c.updated_at DESC, c.created_at DESC, c.id ASC
    ) as attr_rank
  FROM contacts c
  JOIN contact_dedupe_map m ON c.id = m.contact_id
),
aggregated_attributes AS (
  SELECT
    survivor_id,
    (ARRAY_REMOVE(ARRAY_AGG(phone ORDER BY attr_rank), NULL))[1] AS phone,
    (ARRAY_REMOVE(ARRAY_AGG(email ORDER BY attr_rank), NULL))[1] AS email,
    (ARRAY_REMOVE(ARRAY_AGG(
      CASE WHEN full_name != 'Khách Zalo' THEN full_name ELSE NULL END
      ORDER BY attr_rank
    ), NULL))[1] AS preferred_name,
    (ARRAY_REMOVE(ARRAY_AGG(full_name ORDER BY attr_rank), NULL))[1] AS fallback_name,
    (ARRAY_REMOVE(ARRAY_AGG(avatar_url ORDER BY attr_rank), NULL))[1] AS avatar_url,
    (ARRAY_REMOVE(ARRAY_AGG(source ORDER BY attr_rank), NULL))[1] AS source,
    (ARRAY_REMOVE(ARRAY_AGG(source_date ORDER BY attr_rank), NULL))[1] AS source_date,
    (ARRAY_REMOVE(ARRAY_AGG(first_contact_date ORDER BY attr_rank), NULL))[1] AS first_contact_date,
    (ARRAY_REMOVE(ARRAY_AGG(status ORDER BY attr_rank), NULL))[1] AS status,
    (ARRAY_REMOVE(ARRAY_AGG(next_appointment ORDER BY attr_rank), NULL))[1] AS next_appointment,
    (ARRAY_REMOVE(ARRAY_AGG(assigned_user_id ORDER BY attr_rank), NULL))[1] AS assigned_user_id,
    (ARRAY_REMOVE(ARRAY_AGG(notes ORDER BY attr_rank), NULL))[1] AS notes
  FROM ranked_attributes
  GROUP BY survivor_id
)
UPDATE contacts c
SET
  phone = COALESCE(c.phone, a.phone),
  email = COALESCE(c.email, a.email),
  full_name = COALESCE(NULLIF(a.preferred_name, ''), COALESCE(a.fallback_name, c.full_name)),
  avatar_url = COALESCE(c.avatar_url, a.avatar_url),
  source = COALESCE(c.source, a.source),
  source_date = COALESCE(c.source_date, a.source_date),
  first_contact_date = COALESCE(c.first_contact_date, a.first_contact_date),
  status = COALESCE(c.status, a.status),
  next_appointment = COALESCE(c.next_appointment, a.next_appointment),
  assigned_user_id = COALESCE(c.assigned_user_id, a.assigned_user_id),
  notes = COALESCE(c.notes, a.notes)
FROM aggregated_attributes a
WHERE c.id = a.survivor_id;

-- 3. Merge tags (distinct text union, sorted array)
WITH tag_elements AS (
  SELECT DISTINCT
    m.survivor_id,
    tag_elem.value::text AS tag_value
  FROM contacts c
  JOIN contact_dedupe_map m ON c.id = m.contact_id
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(c.tags::jsonb) = 'array' THEN c.tags::jsonb ELSE '[]'::jsonb END
  ) AS tag_elem(value)
),
merged_tags AS (
  SELECT
    survivor_id,
    COALESCE(jsonb_agg(tag_value ORDER BY tag_value), '[]'::jsonb) AS tags_json
  FROM tag_elements
  GROUP BY survivor_id
)
UPDATE contacts c
SET tags = mt.tags_json
FROM merged_tags mt
WHERE c.id = mt.survivor_id;

-- 4. Merge metadata (oldest to newest so newest wins)
WITH metadata_pairs AS (
  SELECT
    m.survivor_id,
    kv.key,
    kv.value,
    ROW_NUMBER() OVER (
      PARTITION BY m.survivor_id, kv.key
      ORDER BY c.updated_at ASC, c.created_at ASC, c.id ASC
    ) as meta_order
  FROM contacts c
  JOIN contact_dedupe_map m ON c.id = m.contact_id
  CROSS JOIN LATERAL jsonb_each(
    CASE WHEN jsonb_typeof(c.metadata::jsonb) = 'object' THEN c.metadata::jsonb ELSE '{}'::jsonb END
  ) AS kv(key, value)
),
winning_metadata AS (
  SELECT survivor_id, key, value
  FROM (
    SELECT survivor_id, key, value,
      ROW_NUMBER() OVER (
        PARTITION BY survivor_id, key
        ORDER BY meta_order DESC
      ) as rn
    FROM metadata_pairs
  ) sub
  WHERE rn = 1
),
merged_meta AS (
  SELECT
    survivor_id,
    COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) AS meta_json
  FROM winning_metadata
  GROUP BY survivor_id
)
UPDATE contacts c
SET metadata = mm.meta_json
FROM merged_meta mm
WHERE c.id = mm.survivor_id;

-- 5. Remap foreign keys to survivor_id
UPDATE conversations c SET contact_id = m.survivor_id
FROM contact_dedupe_map m WHERE m.rank > 1 AND c.contact_id = m.contact_id;

UPDATE orders o SET contact_id = m.survivor_id
FROM contact_dedupe_map m WHERE m.rank > 1 AND o.contact_id = m.contact_id;

UPDATE appointments a SET contact_id = m.survivor_id
FROM contact_dedupe_map m WHERE m.rank > 1 AND a.contact_id = m.contact_id;

-- 6. Delete duplicate contacts
DELETE FROM contacts c
USING contact_dedupe_map m
WHERE m.rank > 1 AND c.id = m.contact_id;

DROP TABLE IF EXISTS contact_dedupe_map;

-- CreateIndex
CREATE UNIQUE INDEX "contacts_org_id_zalo_uid_key" ON "contacts"("org_id", "zalo_uid");

-- Create composite unique candidate keys (org_id, id)
CREATE UNIQUE INDEX "contacts_org_id_id_key" ON "contacts"("org_id", "id");
CREATE UNIQUE INDEX "users_org_id_id_key" ON "users"("org_id", "id");
CREATE UNIQUE INDEX "conversations_org_id_id_key" ON "conversations"("org_id", "id");

-- Add updated_at to conversations (Finding R3-01)
ALTER TABLE "conversations"
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Add lease columns to zalo_outbound_messages (Finding R3-02)
ALTER TABLE "zalo_outbound_messages"
  ADD COLUMN "lease_owner" TEXT,
  ADD COLUMN "lease_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lease_expires_at" TIMESTAMP(3),
  ADD COLUMN "request_started_at" TIMESTAMP(3);

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
