-- AlterTable
ALTER TABLE "zalo_outbound_messages" ADD COLUMN "request_hash" TEXT;

-- Backfill request_hash using SHA-256 of canonical fields
UPDATE "zalo_outbound_messages"
SET "request_hash" = encode(
  sha256(
    convert_to(
      concat(
        '{"accountId":"', "account_id",
        '","attachments":', COALESCE("attachments"::text, '[]'),
        ',"content":"', replace(COALESCE("content", ''), '"', '\"'),
        '","orgId":"', "org_id",
        '","threadId":"', "thread_id", '"}'
      ),
      'UTF8'
    )
  ),
  'hex'
)
WHERE "request_hash" IS NULL;

-- Fallback for any legacy edge cases
UPDATE "zalo_outbound_messages"
SET "request_hash" = encode(sha256(convert_to("id", 'UTF8')), 'hex')
WHERE "request_hash" IS NULL;

-- Enforce NOT NULL constraint
ALTER TABLE "zalo_outbound_messages" ALTER COLUMN "request_hash" SET NOT NULL;
