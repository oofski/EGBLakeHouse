-- ============================================================
-- EBG Lake House — D1 schema
-- ------------------------------------------------------------
-- Apply with:
--   wrangler d1 execute ebg-lakehouse --file=./schema.sql --remote
-- (use --local instead of --remote to seed a local dev database).
-- ============================================================

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  status TEXT,
  renter_name TEXT,
  email TEXT,
  business TEXT,
  purpose TEXT,
  employee_name TEXT,
  check_in TEXT,
  check_out TEXT,
  submitted_at TEXT,
  data TEXT  -- full booking JSON minus large file bytes (files go to R2)
);

CREATE TABLE IF NOT EXISTS blocked_dates (
  date TEXT PRIMARY KEY,
  reason TEXT
);
