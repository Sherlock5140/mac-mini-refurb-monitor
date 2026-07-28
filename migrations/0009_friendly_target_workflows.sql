ALTER TABLE monitor_targets ADD COLUMN archived_at TEXT;

CREATE TABLE IF NOT EXISTS monitor_add_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  confirmation_code TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_at TEXT
);

CREATE INDEX IF NOT EXISTS monitor_add_drafts_status
  ON monitor_add_drafts (status, expires_at);

CREATE TABLE IF NOT EXISTS generic_monitor_state (
  target_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  initialized INTEGER NOT NULL DEFAULT 0,
  products_json TEXT NOT NULL DEFAULT '{}',
  consecutive_errors INTEGER NOT NULL DEFAULT 0,
  last_heartbeat_date TEXT,
  last_run_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  FOREIGN KEY (target_id) REFERENCES monitor_targets(id)
);

CREATE TABLE IF NOT EXISTS generic_monitor_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id TEXT NOT NULL,
  ran_at TEXT NOT NULL,
  status TEXT NOT NULL,
  target_product_count INTEGER,
  event_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  FOREIGN KEY (target_id) REFERENCES monitor_targets(id)
);

CREATE INDEX IF NOT EXISTS generic_monitor_runs_target_time
  ON generic_monitor_runs (target_id, ran_at DESC);
