CREATE TABLE IF NOT EXISTS tigerair_monitor_state (
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

CREATE TABLE IF NOT EXISTS tigerair_monitor_runs (
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

CREATE INDEX IF NOT EXISTS tigerair_monitor_runs_ran_at
  ON tigerair_monitor_runs (ran_at DESC);

INSERT OR IGNORE INTO tigerair_monitor_state (
  id,
  initialized,
  products_json,
  consecutive_errors
) VALUES (
  1,
  0,
  '{}',
  0
);

INSERT OR IGNORE INTO monitor_targets (
  id,
  label,
  adapter_key,
  source_url,
  config_json,
  enabled,
  created_at,
  updated_at
) VALUES (
  'tigerair-promotions',
  '台灣虎航最新優惠',
  'tigerair-promotions',
  'https://www.tigerairtw.com/zh-TW/index',
  '{"notification_events":["new_promotion","promotion_updated"],"schedule":"4,9,14,19,24,29,34,39,44,49,54,59 * * * *"}',
  1,
  '2026-07-28T00:00:00.000Z',
  '2026-07-28T00:00:00.000Z'
);
