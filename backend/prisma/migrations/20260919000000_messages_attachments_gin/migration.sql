-- CreateIndex
CREATE INDEX IF NOT EXISTS messages_attachments_gin ON messages USING gin (attachments);
