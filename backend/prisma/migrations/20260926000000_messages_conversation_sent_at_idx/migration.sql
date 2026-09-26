-- CreateIndex
CREATE INDEX IF NOT EXISTS messages_conversation_id_sent_at_idx ON messages (conversation_id, sent_at DESC);
