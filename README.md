# Apple、Costco 與 PChome 台灣 M4 Mac mini 監控

每 5 分鐘同時檢查
[Apple 台灣認證整修品 Mac 頁面](https://www.apple.com/tw/shop/refurbished/mac)
與
[Costco 台灣桌上型電腦頁](https://www.costco.com.tw/Digital-Mobile/Laptops-Computers/Desktops-Computers/c/20101)、
[PChome 24h](https://24h.pchome.com.tw/search/?q=mac%20mini%20m4)，只追蹤：

- Mac mini
- 標準版 Apple M4（排除 M4 Pro、M4 Max）
- 256GB 或 512GB SSD

偵測新上架、重新補貨、降價與下架；下架必須連續兩次未出現才成立。通知支援 Telegram，並保留 ntfy 作為選用備援。

## 運作方式

- Cloudflare Cron Trigger 在整點起每 5 分鐘執行（`00、05、10……55`）。
- 從 Apple 的 `application/ld+json`、Costco 與 PChome 商品卡片解析商品。
- Costco 與 PChome 都以商品能加入購物車為有貨判定。
- 每次都統計全部商品、所有 Mac、Mac mini 與符合條件的商品數量。
- 設備摘要會簡單列出 MacBook Pro、MacBook Air、iMac、Mac mini 等類型。
- 第一次成功執行只建立基準，不發送「新上架」通知。
- 找不到目標 Mac mini 是正常狀態；找不到 Product 結構或無法辨識任何 Mac 才視為解析錯誤。
- Apple、Costco 與 PChome 使用獨立狀態，最近 7 天執行紀錄保存在 Cloudflare D1。
- 連續錯誤、錯誤恢復與每日一次健康心跳都會通知；健康通知會附上即時設備統計。
- GitHub Actions 不再執行正式監控，只在程式變更時執行 Python 與 Worker 測試。

## 設定 Telegram

1. 在 Telegram 對 `@BotFather` 傳送 `/newbot`。
2. 依指示設定 Bot 名稱及以 `bot` 結尾的 username。
3. 對新 Bot 傳送 `/start`。
4. 使用 Wrangler 將以下值建立為 Cloudflare Worker Secret：
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `TELEGRAM_WEBHOOK_SECRET`
5. 將 Telegram webhook 指向 Worker 的 `/telegram`。

Bot Token 相當於密碼，不得貼在 issue、程式碼或 workflow log。

## Telegram 即時指令

Cloudflare Worker webhook 讓 Bot 能在幾秒內回覆，不需等待下一次 GitHub Actions 排程：

- `/check`：立即查詢 Apple 商品與設備數量
- `/costco`：立即查詢 Costco 台灣 M4 Mac mini 庫存、價格與購買連結
- `/pchome`：立即查詢 PChome 24h M4 Mac mini 庫存、價格與購買連結
- `/coupang`：開啟酷澎搜尋頁並說明自動監控限制
- `/buy`：列出符合條件的商品與直接購買連結
- `/status`：確認即時 Bot、Apple 與 Costco 排程監控狀態
- `/test`：傳送一則與正式事件相同路徑的主動通知測試
- `/link`：顯示 Apple 台灣整修 Mac 購買頁
- `/help`：顯示指令說明

Worker 僅接受設定在 `TELEGRAM_CHAT_ID` 的私人帳號，並使用 Telegram webhook secret 驗證來源。商品通知與查詢結果會附上對應來源的購買連結。

Cloudflare 後台另提供受 `ADMIN_TEST_TOKEN` 保護的
`POST /admin/test`，可在不開啟 Telegram 的情況下測試手機推播。
測試與健康通知會優先顯示目標商品、監控條件及頁面概況，
只保留一個購買連結並關閉大型連結預覽。

目前部署：

- Worker：<https://mac-mini-refurb-monitor-bot.sherlock5140-mac-monitor.workers.dev>
- 健康檢查：<https://mac-mini-refurb-monitor-bot.sherlock5140-mac-monitor.workers.dev/health>

Cloudflare Workers Free 方案提供每日 100,000 次請求額度；每 5 分鐘的單一 Cron 每日執行約 288 次，每次同時檢查三個來源，私人 Bot 的正常查詢用量不需額外費用。

酷澎目前會對 Cloudflare 等伺服器請求回覆 HTTP 403，且買家商品搜尋沒有免憑證的官方公開 API。因此系統不會把搜尋引擎快取冒充即時庫存；`/coupang` 目前僅提供直接搜尋連結。

## Cloudflare 部署

```bash
npm ci
npx wrangler d1 migrations apply mac-mini-refurb-monitor-state --remote
npx wrangler deploy
```

正式部署使用：

- Worker：Telegram webhook、即時指令與定時監控
- Cron Trigger：每 5 分鐘巡查
- D1：商品狀態、錯誤次數、最近成功時間與 7 天執行紀錄
- GitHub Actions：只執行自動測試，不碰正式狀態與通知

## 本機驗證

```bash
python3 -m unittest discover -s tests -v
node --test worker/*.test.mjs
```

`monitor/` 與 `tests/` 保留作為原始 Python 邏輯與回歸測試；正式排程由 Cloudflare Worker 2.0 執行。
