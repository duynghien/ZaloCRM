-- A Zalo upstream message id is only unique inside its persisted conversation.
-- Historical replays may already have duplicated a row. Keep the earliest row
-- (the first delivered event) so the later unique index can be deployed safely.
DELETE FROM "messages" AS duplicate
USING "messages" AS original
WHERE duplicate."conversation_id" = original."conversation_id"
  AND duplicate."zalo_msg_id" = original."zalo_msg_id"
  AND duplicate."zalo_msg_id" IS NOT NULL
  AND (duplicate."created_at", duplicate."id") > (original."created_at", original."id");

-- PostgreSQL unique indexes allow multiple NULL values, preserving rows without
-- an upstream id while making replay insertion atomic.
CREATE UNIQUE INDEX "messages_conversation_id_zalo_msg_id_key"
  ON "messages"("conversation_id", "zalo_msg_id");
