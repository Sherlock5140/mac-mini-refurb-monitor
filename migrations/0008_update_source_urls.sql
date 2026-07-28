UPDATE monitor_targets
SET
  adapter_key = 'costco-products-api',
  updated_at = '2026-07-28T00:00:00.000Z'
WHERE id = 'costco-mac-mini';

UPDATE monitor_targets
SET
  source_url = 'https://www.tw.coupang.com/np/search?q=mac%20mini%20m4',
  updated_at = '2026-07-28T00:00:00.000Z'
WHERE id = 'coupang-mac-mini';

UPDATE monitor_targets
SET
  source_url = 'https://www.tw.coupang.com/np/search?q=WH-1000XM6',
  updated_at = '2026-07-28T00:00:00.000Z'
WHERE id = 'coupang-sony-xm6';
