import unittest

from monitor.parser import Product
from monitor.state import apply_error, apply_inventory, empty_state


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


class StateTests(unittest.TestCase):
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
