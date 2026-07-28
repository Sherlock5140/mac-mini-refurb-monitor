UPDATE monitor_targets
SET
  config_json = '{"notification_events":["catalog_update"],"schedule":"14,44 * * * *","verification":"community-unverified"}',
  updated_at = '2026-07-29T00:00:00.000Z'
WHERE id = 'chatgpt-business-promo-updates';
