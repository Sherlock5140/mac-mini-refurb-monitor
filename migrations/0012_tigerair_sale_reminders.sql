UPDATE monitor_targets
SET
  config_json = json_set(
    config_json,
    '$.notification_events',
    json('["new_promotion","promotion_updated","sale_open"]'),
    '$.schedule',
    '4,34 * * * *'
  ),
  updated_at = '2026-07-28T13:22:59.000Z'
WHERE id = 'tigerair-promotions';
