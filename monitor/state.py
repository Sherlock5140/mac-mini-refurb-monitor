"""State transitions and alert generation for product inventory."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Iterable

from .parser import Product


@dataclass(frozen=True)
class Event:
    kind: str
    title: str
    message: str
    url: str | None = None
    priority: int = 4
    tags: tuple[str, ...] = ()


def empty_state() -> dict[str, Any]:
    return {
        "version": 1,
        "initialized": False,
        "products": {},
        "consecutive_errors": 0,
        "last_heartbeat_date": None,
    }


def _display(product: dict[str, Any]) -> str:
    memory = product.get("memory_gb")
    memory_text = f"、{memory}GB 記憶體" if memory else ""
    return (
        f"{product['name']}\n"
        f"{product['storage_gb']}GB SSD{memory_text}\n"
        f"NT${product['price_twd']:,}"
    )


def apply_inventory(
    state: dict[str, Any],
    current_products: Iterable[Product],
    now_iso: str,
) -> tuple[dict[str, Any], list[Event]]:
    """Apply one successful inventory observation without mutating input state."""
    updated = deepcopy(state)
    updated.setdefault("products", {})
    current = {item.product_id: item.to_dict() for item in current_products}
    events: list[Event] = []

    if not updated.get("initialized"):
        for product_id, product in current.items():
            updated["products"][product_id] = {
                **product,
                "present": True,
                "missing_count": 0,
                "first_seen_at": now_iso,
            }
        updated["initialized"] = True
        updated["consecutive_errors"] = 0
        return updated, events

    stored_products = updated["products"]
    for product_id, observed in current.items():
        stored = stored_products.get(product_id)
        if stored is None:
            stored_products[product_id] = {
                **observed,
                "present": True,
                "missing_count": 0,
                "first_seen_at": now_iso,
            }
            events.append(
                Event(
                    kind="new",
                    title="M4 Mac mini 新上架",
                    message=_display(observed),
                    url=observed["url"],
                    priority=5,
                    tags=("computer", "new"),
                )
            )
            continue

        was_present = bool(stored.get("present"))
        previous_price = int(stored["price_twd"])
        stored.update(observed)
        stored["present"] = True
        stored["missing_count"] = 0

        if not was_present:
            events.append(
                Event(
                    kind="restock",
                    title="M4 Mac mini 重新補貨",
                    message=_display(observed),
                    url=observed["url"],
                    priority=5,
                    tags=("computer", "tada"),
                )
            )
        elif observed["price_twd"] < previous_price:
            events.append(
                Event(
                    kind="price_drop",
                    title="M4 Mac mini 降價",
                    message=(
                        f"{_display(observed)}\n"
                        f"原價 NT${previous_price:,}，降價 NT${previous_price - observed['price_twd']:,}"
                    ),
                    url=observed["url"],
                    priority=5,
                    tags=("computer", "money_with_wings"),
                )
            )

    for product_id, stored in stored_products.items():
        if product_id in current or not stored.get("present"):
            continue
        missing_count = int(stored.get("missing_count", 0)) + 1
        stored["missing_count"] = missing_count
        if missing_count >= 2:
            stored["present"] = False
            events.append(
                Event(
                    kind="removed",
                    title="M4 Mac mini 已下架",
                    message=_display(stored),
                    url=stored.get("url"),
                    priority=3,
                    tags=("computer", "no_entry"),
                )
            )

    updated["consecutive_errors"] = 0
    return updated, events


def apply_error(
    state: dict[str, Any], error_message: str
) -> tuple[dict[str, Any], list[Event]]:
    updated = deepcopy(state)
    count = int(updated.get("consecutive_errors", 0)) + 1
    updated["consecutive_errors"] = count
    events: list[Event] = []
    if count in {1, 3, 6}:
        events.append(
            Event(
                kind="error",
                title="Mac mini 監控異常",
                message=f"連續錯誤 {count} 次\n{error_message[:500]}",
                priority=4 if count == 1 else 5,
                tags=("warning", "computer"),
            )
        )
    return updated, events


def recovery_event(previous_error_count: int) -> Event | None:
    if previous_error_count <= 0:
        return None
    return Event(
        kind="recovered",
        title="Mac mini 監控已恢復",
        message=f"先前連續錯誤 {previous_error_count} 次，本次已成功取得並解析 Apple 商品資料。",
        priority=3,
        tags=("white_check_mark", "computer"),
    )


def heartbeat_event() -> Event:
    return Event(
        kind="heartbeat",
        title="Mac mini 監控正常",
        message="Apple 台灣整修品監控仍在正常執行。",
        priority=2,
        tags=("green_heart", "computer"),
    )
