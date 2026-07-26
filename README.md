# Apple M4 Mac mini 整修品監控

每 5 分鐘檢查 [Apple 台灣認證整修品 Mac 頁面](https://www.apple.com/tw/shop/refurbished/mac)，只追蹤：

- Mac mini
- 標準版 Apple M4（排除 M4 Pro、M4 Max）
- 256GB 或 512GB SSD

偵測新上架、重新補貨、降價與下架；下架必須連續兩次未出現才成立。通知支援 Telegram，並保留 ntfy 作為選用備援。

## 運作方式

- GitHub Actions 在每小時 `02、07、12……57` 分執行。
- 從 Apple 頁面的 `application/ld+json` Product 資料解析商品。
- 每次都統計全部商品、所有 Mac、Mac mini 與符合條件的商品數量。
- 設備摘要會簡單列出 MacBook Pro、MacBook Air、iMac、Mac mini 等類型。
- 第一次成功執行只建立基準，不發送「新上架」通知。
- 找不到目標 Mac mini 是正常狀態；找不到 Product 結構或無法辨識任何 Mac 才視為解析錯誤。
- 狀態保存在 `state/products.json`，只有狀態改變時才由 workflow 提交。
- 連續錯誤、錯誤恢復與每日一次健康心跳都會通知；健康通知會附上即時設備統計。

> GitHub Actions 的 5 分鐘是最短排程間隔，不是準時保證；高負載時可能延遲或漏跑。

## 設定 Telegram

1. 在 Telegram 對 `@BotFather` 傳送 `/newbot`。
2. 依指示設定 Bot 名稱及以 `bot` 結尾的 username。
3. 對新 Bot 傳送 `/start`。
4. 在 GitHub repository 的 **Settings → Secrets and variables → Actions** 建立：
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
5. 前往 **Actions → Monitor Apple M4 Mac mini → Run workflow**。
6. 勾選 `Send a test notification` 後執行。

Bot Token 相當於密碼，不得貼在 issue、程式碼或 workflow log。

## 選用 ntfy 備援

1. 在 iPhone 的 ntfy App 訂閱一個長且不可猜測的 topic。
2. 開啟 GitHub repository 的 **Settings → Secrets and variables → Actions**。
3. 建立 repository secret：
   - Name：`NTFY_TOPIC`
   - Secret：你的 ntfy topic 名稱（不要包含 `https://ntfy.sh/`）
4. 前往 **Actions → Monitor Apple M4 Mac mini → Run workflow**。
5. 勾選 `Send a test notification` 後執行。

Telegram 與 ntfy 可以同時啟用；完全未設定通知 Secret 時 workflow 會明確失敗，避免商品狀態改變卻沒有通知。

## 本機驗證

```bash
python3 -m unittest discover -s tests -v
python3 -m monitor.cli --state-file /tmp/mac-mini-monitor-state.json
```

本機執行正式監控前請設定：

```bash
export NTFY_TOPIC="你的隨機-topic"
# 或
export TELEGRAM_BOT_TOKEN="BotFather 提供的 token"
export TELEGRAM_CHAT_ID="你的 chat ID"
```

## 手動測試通知

```bash
python3 -m monitor.cli \
  --state-file /tmp/mac-mini-monitor-state.json \
  --test-notification
```

測試通知會即時解析 Apple 頁面並附上設備統計，不會製造假商品，也不會重設既有商品狀態。
