CREATE TABLE IF NOT EXISTS monitor_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL DEFAULT 1,
  initialized INTEGER NOT NULL DEFAULT 0,
  products_json TEXT NOT NULL DEFAULT '{}',
  consecutive_errors INTEGER NOT NULL DEFAULT 0,
  last_heartbeat_date TEXT,
  last_run_at TEXT,
  last_success_at TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS monitor_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at TEXT NOT NULL,
  status TEXT NOT NULL,
  total_product_count INTEGER,
  mac_product_count INTEGER,
  mac_mini_count INTEGER,
  target_product_count INTEGER,
  event_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS monitor_runs_ran_at
  ON monitor_runs (ran_at DESC);

INSERT OR IGNORE INTO monitor_state (
  id,
  initialized,
  products_json,
  consecutive_errors,
  last_heartbeat_date
) VALUES (
  1,
  1,
  '{}',
  0,
  '2026-07-26'
);
