-- Preflight check: verify no cross-tenant foreign key violations exist before applying constraints
DO $$
DECLARE
  v_violations text := '';
  v_count integer;
BEGIN
  -- Check conversations -> zalo_accounts
  SELECT COUNT(*) INTO v_count
  FROM "conversations" c
  WHERE c."zalo_account_id" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "zalo_accounts" z
      WHERE z."org_id" = c."org_id" AND z."id" = c."zalo_account_id"
    );
  IF v_count > 0 THEN
    v_violations := v_violations || format('conversations.zalo_account_id cross-tenant violations: %s; ', v_count);
  END IF;

  -- Check conversations -> contacts
  SELECT COUNT(*) INTO v_count
  FROM "conversations" c
  WHERE c."contact_id" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "contacts" ct
      WHERE ct."org_id" = c."org_id" AND ct."id" = c."contact_id"
    );
  IF v_count > 0 THEN
    v_violations := v_violations || format('conversations.contact_id cross-tenant violations: %s; ', v_count);
  END IF;

  -- Check appointments -> contacts
  SELECT COUNT(*) INTO v_count
  FROM "appointments" a
  WHERE a."contact_id" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "contacts" ct
      WHERE ct."org_id" = a."org_id" AND ct."id" = a."contact_id"
    );
  IF v_count > 0 THEN
    v_violations := v_violations || format('appointments.contact_id cross-tenant violations: %s; ', v_count);
  END IF;

  -- Check appointments -> users
  SELECT COUNT(*) INTO v_count
  FROM "appointments" a
  WHERE a."assigned_user_id" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "users" u
      WHERE u."org_id" = a."org_id" AND u."id" = a."assigned_user_id"
    );
  IF v_count > 0 THEN
    v_violations := v_violations || format('appointments.assigned_user_id cross-tenant violations: %s; ', v_count);
  END IF;

  -- Check orders -> contacts
  SELECT COUNT(*) INTO v_count
  FROM "orders" o
  WHERE o."contact_id" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "contacts" ct
      WHERE ct."org_id" = o."org_id" AND ct."id" = o."contact_id"
    );
  IF v_count > 0 THEN
    v_violations := v_violations || format('orders.contact_id cross-tenant violations: %s; ', v_count);
  END IF;

  -- Check orders -> users
  SELECT COUNT(*) INTO v_count
  FROM "orders" o
  WHERE o."created_by_user_id" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "users" u
      WHERE u."org_id" = o."org_id" AND u."id" = o."created_by_user_id"
    );
  IF v_count > 0 THEN
    v_violations := v_violations || format('orders.created_by_user_id cross-tenant violations: %s; ', v_count);
  END IF;

  -- Check orders -> conversations
  SELECT COUNT(*) INTO v_count
  FROM "orders" o
  WHERE o."conversation_id" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "conversations" c
      WHERE c."org_id" = o."org_id" AND c."id" = o."conversation_id"
    );
  IF v_count > 0 THEN
    v_violations := v_violations || format('orders.conversation_id cross-tenant violations: %s; ', v_count);
  END IF;

  IF v_violations <> '' THEN
    RAISE EXCEPTION 'preflight_composite_fk_violations_found: %', v_violations;
  END IF;
END $$;

-- 1. Ensure unique constraint on zalo_accounts(org_id, id)
CREATE UNIQUE INDEX IF NOT EXISTS "zalo_accounts_org_id_id_key" ON "zalo_accounts"("org_id", "id");

-- 2. Drop legacy single-column foreign keys
ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_zalo_account_id_fkey";
ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_contact_id_fkey";
ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_contact_id_fkey";
ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_assigned_user_id_fkey";
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_contact_id_fkey";
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_created_by_user_id_fkey";
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_conversation_id_fkey";

-- 3. Add composite foreign key constraints
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_org_id_zalo_account_id_fkey"
  FOREIGN KEY ("org_id", "zalo_account_id") REFERENCES "zalo_accounts"("org_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_org_id_contact_id_fkey"
  FOREIGN KEY ("org_id", "contact_id") REFERENCES "contacts"("org_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_org_id_contact_id_fkey"
  FOREIGN KEY ("org_id", "contact_id") REFERENCES "contacts"("org_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_org_id_assigned_user_id_fkey"
  FOREIGN KEY ("org_id", "assigned_user_id") REFERENCES "users"("org_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "orders" ADD CONSTRAINT "orders_org_id_contact_id_fkey"
  FOREIGN KEY ("org_id", "contact_id") REFERENCES "contacts"("org_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "orders" ADD CONSTRAINT "orders_org_id_created_by_user_id_fkey"
  FOREIGN KEY ("org_id", "created_by_user_id") REFERENCES "users"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "orders" ADD CONSTRAINT "orders_org_id_conversation_id_fkey"
  FOREIGN KEY ("org_id", "conversation_id") REFERENCES "conversations"("org_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;
