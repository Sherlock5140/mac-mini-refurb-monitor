import json
import unittest
from unittest.mock import patch

from monitor.notify import publish_telegram
from monitor.state import Event


class _Response:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return b'{"ok":true,"result":{"message_id":1}}'


class TelegramNotificationTests(unittest.TestCase):
    @patch("monitor.notify.urlopen", return_value=_Response())
    def test_sends_telegram_message_with_product_url(self, mocked_urlopen):
        event = Event(
            kind="new",
            title="M4 Mac mini 新上架",
            message="256GB SSD\nNT$17,000",
            url="https://www.apple.com/tw/shop/product/test",
        )

        publish_telegram("secret-token", "123456", event)

        request = mocked_urlopen.call_args.args[0]
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["chat_id"], "123456")
        self.assertIn(event.title, payload["text"])
        self.assertIn(event.url, payload["text"])
        self.assertIn("secret-token", request.full_url)


if __name__ == "__main__":
    unittest.main()
