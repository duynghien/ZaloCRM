-- Keep old order writers stopped until the new transactional allocator is live.
-- The lock closes the gap between duplicate inspection, seeding and uniqueness.
BEGIN;
LOCK TABLE orders IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM orders GROUP BY org_id, order_code HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'duplicate_order_codes_require_operator_resolution';
  END IF;
END $$;

CREATE TABLE order_code_counters (
  org_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  last_value BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT order_code_counters_pkey PRIMARY KEY (org_id,date_key),
  CONSTRAINT order_code_counters_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT order_code_counters_value_check CHECK (last_value >= 0),
  CONSTRAINT order_code_counters_date_check CHECK (date_key ~ '^[0-9]{8}$')
);

-- Calendar round-trip uses interval arithmetic so malformed historical dates
-- remain untouched instead of throwing from a permissive date parser.
CREATE TEMP TABLE order_code_seed ON COMMIT DROP AS
WITH matched AS (
  SELECT org_id, regexp_match(order_code, '^ORD-([0-9]{8})-([0-9]{3,})$') AS parts FROM orders
), valid AS (
  SELECT org_id, parts[1] AS date_key, parts[2]::numeric AS suffix FROM matched
  WHERE parts IS NOT NULL AND substring(parts[1],1,4)::integer > 0
    AND to_char(DATE '2000-01-01'
      + (substring(parts[1],1,4)::integer - 2000) * INTERVAL '1 year'
      + (substring(parts[1],5,2)::integer - 1) * INTERVAL '1 month'
      + (substring(parts[1],7,2)::integer - 1) * INTERVAL '1 day', 'YYYYMMDD') = parts[1]
)
SELECT org_id,date_key,max(suffix) AS last_value FROM valid GROUP BY org_id,date_key;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM order_code_seed WHERE last_value >= 9223372036854775807) THEN
    RAISE EXCEPTION 'order_code_counter_exhausted_requires_operator_resolution';
  END IF;
END $$;
INSERT INTO order_code_counters(org_id,date_key,last_value)
  SELECT org_id,date_key,last_value::bigint FROM order_code_seed;
CREATE UNIQUE INDEX orders_org_id_order_code_key ON orders(org_id,order_code);
COMMIT;
