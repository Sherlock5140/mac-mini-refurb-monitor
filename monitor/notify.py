"""Notification publishers for ntfy and Telegram."""

from __future__ import annotations

import json
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from .state import Event


class NotificationError(RuntimeError):
    """Raised when a notification provider rejects a message."""


def publish_ntfy(topic: str, event: Event, timeout: int = 20) -> None:
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


def publish_telegram(
    bot_token: str,
    chat_id: str,
    event: Event,
    timeout: int = 20,
) -> None:
    message = f"{event.title}\n\n{event.message}"
    if event.url:
        message += f"\n\n{event.url}"
    payload = {
        "chat_id": chat_id,
        "text": message,
        "disable_web_page_preview": False,
    }
    request = Request(
        f"https://api.telegram.org/bot{bot_token}/sendMessage",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "mac-mini-refurb-monitor/1.1",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8"))
            if response.status >= 300 or not body.get("ok"):
                raise NotificationError(
                    f"Telegram API 拒絕訊息（HTTP {response.status}）"
                )
    except HTTPError as error:
        # Do not include error.url because it contains the bot token.
        raise NotificationError(
            f"Telegram 發送失敗（HTTP {error.code}）"
        ) from error
    except NotificationError:
        raise
    except Exception as error:
        # Keep the token out of logs even when urllib includes the request URL.
        raise NotificationError(
            f"Telegram 發送失敗（{type(error).__name__}）"
        ) from error
