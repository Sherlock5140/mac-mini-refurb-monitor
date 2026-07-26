"""ntfy publisher."""

from __future__ import annotations

import json
from urllib.request import Request, urlopen

from .state import Event


class NotificationError(RuntimeError):
    """Raised when ntfy rejects a notification."""


def publish(topic: str, event: Event, timeout: int = 20) -> None:
    payload: dict[str, object] = {
        "topic": topic,
        "title": event.title,
        "message": event.message,
        "priority": event.priority,
    }
    if event.tags:
        payload["tags"] = list(event.tags)
    if event.url:
        payload["click"] = event.url

    request = Request(
        "https://ntfy.sh/",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "mac-mini-refurb-monitor/1.0",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            if response.status >= 300:
                raise NotificationError(f"ntfy HTTP {response.status}")
    except Exception as error:
        if isinstance(error, NotificationError):
            raise
        raise NotificationError(f"ntfy 發送失敗：{error}") from error
