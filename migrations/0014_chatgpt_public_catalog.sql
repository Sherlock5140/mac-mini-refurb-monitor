UPDATE monitor_targets
SET
  adapter_key = 'chatgpt-public-catalog',
  config_json = '{"notification_events":["catalog_added","catalog_changed","catalog_expired","catalog_removed"],"schedule":"14,44 * * * *","verification":"community-unverified"}',
  updated_at = '2026-07-29T00:00:00.000Z'
WHERE id = 'chatgpt-business-promo-updates';
