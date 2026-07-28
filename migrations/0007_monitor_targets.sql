CREATE TABLE IF NOT EXISTS monitor_targets (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  adapter_key TEXT NOT NULL,
  source_url TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS monitor_change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  confirmation_code TEXT NOT NULL UNIQUE,
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  FOREIGN KEY (target_id) REFERENCES monitor_targets(id)
);

CREATE INDEX IF NOT EXISTS monitor_change_requests_status
  ON monitor_change_requests (status, expires_at);

CREATE TABLE IF NOT EXISTS monitor_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO monitor_targets (
  id, label, adapter_key, source_url, config_json, enabled, created_at, updated_at
) VALUES
  (
    'apple-mac-mini',
    'Apple M4 Mac mini',
    'apple-refurb-mac',
    'https://www.apple.com/tw/shop/refurbished/mac',
    '{"notification_events":["new","restock","price_drop","removed"],"schedule":"*/5 * * * *"}',
    1,
    '2026-07-28T00:00:00.000Z',
    '2026-07-28T00:00:00.000Z'
  ),
  (
    'costco-mac-mini',
    'Costco M4 Mac mini',
    'costco-category',
    'https://www.costco.com.tw/Digital-Mobile/Laptops-Computers/Desktops-Computers/c/20101',
    '{"notification_events":["new","restock","price_drop","removed"],"schedule":"*/5 * * * *"}',
    1,
    '2026-07-28T00:00:00.000Z',
    '2026-07-28T00:00:00.000Z'
  ),
  (
    'pchome-mac-mini',
    'PChome M4 Mac mini',
    'pchome-search',
    'https://24h.pchome.com.tw/search/?q=mac%20mini%20m4',
    '{"notification_events":["new","restock","price_drop","removed"],"schedule":"*/5 * * * *"}',
    1,
    '2026-07-28T00:00:00.000Z',
    '2026-07-28T00:00:00.000Z'
  ),
  (
    'coupang-mac-mini',
    '酷澎 M4 Mac mini',
    'coupang-browser-search',
    'https://www.tw.coupang.com/srp/mac-mini?q=mac%20mini%20m4',
    '{"notification_events":["new","restock","price_drop","removed"],"schedule":"*/5 * * * *"}',
    1,
    '2026-07-28T00:00:00.000Z',
    '2026-07-28T00:00:00.000Z'
  ),
  (
    'coupang-sony-xm6',
    '酷澎 Sony WH-1000XM6',
    'coupang-browser-search',
    'https://www.tw.coupang.com/srp/wh-1000xm6?q=WH-1000XM6',
    '{"notification_events":["price_drop"],"schedule":"2,7,12,17,22,27,32,37,42,47,52,57 * * * *"}',
    1,
    '2026-07-28T00:00:00.000Z',
    '2026-07-28T00:00:00.000Z'
  );
