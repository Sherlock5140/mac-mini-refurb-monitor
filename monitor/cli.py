"""Command-line entry point for the monitor."""

from __future__ import annotations

import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import sys
from tempfile import NamedTemporaryFile
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from .notify import NotificationError, publish_ntfy, publish_telegram
from .parser import parse_products
from .state import (
    Event,
    apply_error,
    apply_inventory,
    empty_state,
    heartbeat_event,
    recovery_event,
)


APPLE_URL = "https://www.apple.com/tw/shop/refurbished/mac"
TAIPEI = ZoneInfo("Asia/Taipei")


def load_state(path: Path) -> dict:
    if not path.exists():
        return empty_state()
    with path.open(encoding="utf-8") as handle:
        state = json.load(handle)
    if state.get("version") != 1 or not isinstance(state.get("products"), dict):
        raise RuntimeError("狀態檔格式不相容")
    return state


def save_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(
        state, ensure_ascii=False, indent=2, sort_keys=True
    ) + "\n"
    with NamedTemporaryFile(
        "w", encoding="utf-8", dir=path.parent, delete=False
    ) as handle:
        handle.write(serialized)
        temporary_path = Path(handle.name)
    temporary_path.replace(path)


def fetch_html(timeout: int = 30) -> str:
    request = Request(
        APPLE_URL,
        headers={
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.7",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 Safari/537.36 "
                "mac-mini-refurb-monitor/1.0"
            ),
        },
    )
    with urlopen(request, timeout=timeout) as response:
        if response.status != 200:
            raise RuntimeError(f"Apple HTTP {response.status}")
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def _send_all(
    events: list[Event],
    *,
    ntfy_topic: str,
    telegram_bot_token: str,
    telegram_chat_id: str,
) -> None:
    for event in events:
        if telegram_bot_token and telegram_chat_id:
            publish_telegram(
                telegram_bot_token,
                telegram_chat_id,
                event,
            )
            print(f"Telegram 已發送：{event.kind}")
        if ntfy_topic:
            publish_ntfy(ntfy_topic, event)
            print(f"ntfy 已發送：{event.kind}")


def run(
    state_path: Path,
    *,
    ntfy_topic: str,
    telegram_bot_token: str,
    telegram_chat_id: str,
    send_test: bool = False,
) -> int:
    telegram_partial = bool(telegram_bot_token) != bool(telegram_chat_id)
    if telegram_partial:
        print(
            "錯誤：TELEGRAM_BOT_TOKEN 與 TELEGRAM_CHAT_ID 必須同時設定。",
            file=sys.stderr,
        )
        return 2
    if not ntfy_topic and not telegram_bot_token:
        print(
            "錯誤：尚未設定 Telegram 或 ntfy 通知 Secret。",
            file=sys.stderr,
        )
        return 2

    if send_test:
        _send_all(
            [
                Event(
                    kind="test",
                    title="Mac mini 監控測試成功",
                    message="GitHub Actions 已能正常傳送監控通知。",
                    priority=4,
                    tags=("white_check_mark", "computer"),
                )
            ],
            ntfy_topic=ntfy_topic,
            telegram_bot_token=telegram_bot_token,
            telegram_chat_id=telegram_chat_id,
        )
        print("測試通知已發送")

    state = load_state(state_path)
    previous_errors = int(state.get("consecutive_errors", 0))
    now = datetime.now(TAIPEI)
    now_iso = now.isoformat(timespec="seconds")

    try:
        products = parse_products(fetch_html())
        updated, events = apply_inventory(state, products, now_iso)
        recovered = recovery_event(previous_errors)
        if recovered:
            events.insert(0, recovered)

        today = now.date().isoformat()
        if (
            state.get("initialized")
            and updated.get("last_heartbeat_date") != today
        ):
            events.append(heartbeat_event())
            updated["last_heartbeat_date"] = today
        elif not state.get("initialized"):
            updated["last_heartbeat_date"] = today

        _send_all(
            events,
            ntfy_topic=ntfy_topic,
            telegram_bot_token=telegram_bot_token,
            telegram_chat_id=telegram_chat_id,
        )
        save_state(state_path, updated)
        print(
            f"監控成功：解析到 {len(products)} 項符合條件的商品，"
            f"事件 {len(events)} 項。"
        )
        return 0
    except NotificationError:
        # Do not advance state when an important notification was not delivered.
        raise
    except Exception as error:
        updated, events = apply_error(state, str(error))
        try:
            _send_all(
                events,
                ntfy_topic=ntfy_topic,
                telegram_bot_token=telegram_bot_token,
                telegram_chat_id=telegram_chat_id,
            )
        finally:
            save_state(state_path, updated)
        print(f"監控失敗：{error}", file=sys.stderr)
        # The error is handled and persisted; keep the workflow alive so it can
        # commit the error count used by consecutive-error protection.
        return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Monitor Apple Taiwan refurbished M4 Mac mini inventory."
    )
    parser.add_argument(
        "--state-file",
        type=Path,
        default=Path("state/products.json"),
    )
    parser.add_argument("--test-notification", action="store_true")
    return parser


def main() -> int:
    arguments = build_parser().parse_args()
    try:
        return run(
            state_path=arguments.state_file,
            ntfy_topic=os.environ.get("NTFY_TOPIC", "").strip(),
            telegram_bot_token=os.environ.get(
                "TELEGRAM_BOT_TOKEN", ""
            ).strip(),
            telegram_chat_id=os.environ.get(
                "TELEGRAM_CHAT_ID", ""
            ).strip(),
            send_test=arguments.test_notification,
        )
    except (NotificationError, OSError, RuntimeError, json.JSONDecodeError) as error:
        print(f"錯誤：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
