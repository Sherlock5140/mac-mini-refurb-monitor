CREATE TABLE IF NOT EXISTS airpods_monitor_state (
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

CREATE TABLE IF NOT EXISTS airpods_monitor_runs (
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

CREATE INDEX IF NOT EXISTS airpods_monitor_runs_ran_at
  ON airpods_monitor_runs (ran_at DESC);

INSERT OR IGNORE INTO airpods_monitor_state (
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
  'coupang-airpods-pro-3',
  '酷澎 AirPods Pro 3',
  'coupang-browser-search',
  'https://www.tw.coupang.com/np/search?q=AirPods%20Pro%203',
  '{"notification_events":["price_drop"],"schedule":"27,57 * * * *"}',
  1,
  '2026-07-29T00:00:00.000Z',
  '2026-07-29T00:00:00.000Z'
);

UPDATE monitor_targets
SET
  config_json = '{"notification_events":["new","restock","price_drop","removed"],"schedule":"7,37 * * * *"}',
  updated_at = '2026-07-29T00:00:00.000Z'
WHERE id = 'coupang-mac-mini';

UPDATE monitor_targets
SET
  config_json = '{"notification_events":["price_drop"],"schedule":"17,47 * * * *"}',
  updated_at = '2026-07-29T00:00:00.000Z'
WHERE id = 'coupang-sony-xm6';
