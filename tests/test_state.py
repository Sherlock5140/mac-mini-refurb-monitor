import unittest

from monitor.parser import InventorySnapshot, Product
from monitor.state import (
    apply_error,
    apply_inventory,
    empty_state,
    heartbeat_event,
    test_event as build_test_event,
)


def sample(product_id="FTESTTA-A", price=17000):
    return Product(
        product_id=product_id,
        sku=product_id.replace("-", "/", 1),
        name="Mac mini Apple M4 晶片 (整修品)",
        storage_gb=256,
        memory_gb=16,
        price_twd=price,
        url=f"https://www.apple.com/tw/shop/product/{product_id.lower()}",
    )


def inventory_snapshot():
    return InventorySnapshot(
        target_products=(sample(),),
        total_product_count=43,
        mac_product_count=39,
        mac_mini_count=1,
        device_counts=(
            ("Mac mini", 1),
            ("MacBook Pro", 20),
            ("iMac", 18),
        ),
    )


class StateTests(unittest.TestCase):
    def test_health_events_explain_visible_device_types(self):
        snapshot = inventory_snapshot()

        for event in (heartbeat_event(snapshot), build_test_event(snapshot)):
            self.assertIn("全部商品：43 項", event.message)
            self.assertIn("Mac：39 項", event.message)
            self.assertIn("MacBook Pro 20 項", event.message)
            self.assertIn("iMac 18 項", event.message)
            self.assertIn("符合 M4 mini 256／512GB：1 項", event.message)

    def test_first_run_creates_baseline_without_alert(self):
        state, events = apply_inventory(empty_state(), [sample()], "2026-07-26T10:00:00+08:00")
        self.assertTrue(state["initialized"])
        self.assertEqual(events, [])

    def test_new_product_alert(self):
        state, _ = apply_inventory(empty_state(), [], "2026-07-26T10:00:00+08:00")
        _, events = apply_inventory(state, [sample()], "2026-07-26T10:05:00+08:00")
        self.assertEqual([event.kind for event in events], ["new"])

    def test_price_drop_alert(self):
        state, _ = apply_inventory(empty_state(), [sample()], "2026-07-26T10:00:00+08:00")
        _, events = apply_inventory(state, [sample(price=16000)], "2026-07-26T10:05:00+08:00")
        self.assertEqual([event.kind for event in events], ["price_drop"])

    def test_price_increase_does_not_alert(self):
        state, _ = apply_inventory(empty_state(), [sample()], "2026-07-26T10:00:00+08:00")
        _, events = apply_inventory(state, [sample(price=18000)], "2026-07-26T10:05:00+08:00")
        self.assertEqual(events, [])

    def test_removal_requires_two_missing_observations(self):
        state, _ = apply_inventory(empty_state(), [sample()], "2026-07-26T10:00:00+08:00")
        state, first_events = apply_inventory(state, [], "2026-07-26T10:05:00+08:00")
        self.assertEqual(first_events, [])
        self.assertTrue(state["products"]["FTESTTA-A"]["present"])
        state, second_events = apply_inventory(state, [], "2026-07-26T10:10:00+08:00")
        self.assertEqual([event.kind for event in second_events], ["removed"])
        self.assertFalse(state["products"]["FTESTTA-A"]["present"])

    def test_restock_after_confirmed_removal(self):
        state, _ = apply_inventory(empty_state(), [sample()], "2026-07-26T10:00:00+08:00")
        state, _ = apply_inventory(state, [], "2026-07-26T10:05:00+08:00")
        state, _ = apply_inventory(state, [], "2026-07-26T10:10:00+08:00")
        state, events = apply_inventory(state, [sample()], "2026-07-26T10:15:00+08:00")
        self.assertEqual([event.kind for event in events], ["restock"])
        self.assertTrue(state["products"]["FTESTTA-A"]["present"])

    def test_single_missing_observation_resets_when_product_returns(self):
        state, _ = apply_inventory(empty_state(), [sample()], "2026-07-26T10:00:00+08:00")
        state, _ = apply_inventory(state, [], "2026-07-26T10:05:00+08:00")
        state, events = apply_inventory(state, [sample()], "2026-07-26T10:10:00+08:00")
        self.assertEqual(events, [])
        self.assertEqual(state["products"]["FTESTTA-A"]["missing_count"], 0)

    def test_error_does_not_change_inventory(self):
        state, _ = apply_inventory(empty_state(), [sample()], "2026-07-26T10:00:00+08:00")
        updated, events = apply_error(state, "temporary failure")
        self.assertEqual(updated["products"], state["products"])
        self.assertEqual([event.kind for event in events], ["error"])

    def test_error_notifications_are_throttled(self):
        state = empty_state()
        emitted = []
        for _ in range(7):
            state, events = apply_error(state, "temporary failure")
            emitted.extend(event.kind for event in events)
        self.assertEqual(emitted, ["error", "error", "error"])


if __name__ == "__main__":
    unittest.main()
