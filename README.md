# Apple M4 Mac mini 整修品監控

每 5 分鐘檢查 [Apple 台灣認證整修品 Mac 頁面](https://www.apple.com/tw/shop/refurbished/mac)，只追蹤：

- Mac mini
- 標準版 Apple M4（排除 M4 Pro、M4 Max）
- 256GB 或 512GB SSD

偵測新上架、重新補貨、降價與下架；下架必須連續兩次未出現才成立。通知透過 ntfy 傳送。

## 運作方式

- GitHub Actions 在每小時 `02、07、12……57` 分執行。
- 從 Apple 頁面的 `application/ld+json` Product 資料解析商品。
- 第一次成功執行只建立基準，不發送「新上架」通知。
- 找不到目標商品是正常狀態；找不到任何 Product 結構才視為解析錯誤。
- 狀態保存在 `state/products.json`，只有狀態改變時才由 workflow 提交。
- 連續錯誤、錯誤恢復與每日一次健康心跳都會通知。

> GitHub Actions 的 5 分鐘是最短排程間隔，不是準時保證；高負載時可能延遲或漏跑。

## 設定 `NTFY_TOPIC`

1. 在 iPhone 的 ntfy App 訂閱一個長且不可猜測的 topic。
2. 開啟 GitHub repository 的 **Settings → Secrets and variables → Actions**。
3. 建立 repository secret：
   - Name：`NTFY_TOPIC`
   - Secret：你的 ntfy topic 名稱（不要包含 `https://ntfy.sh/`）
4. 前往 **Actions → Monitor Apple M4 Mac mini → Run workflow**。
5. 勾選 `Send a test ntfy notification` 後執行。

未設定 Secret 時 workflow 會明確失敗，避免商品狀態改變卻沒有通知。

## 本機驗證

```bash
python3 -m unittest discover -s tests -v
python3 -m monitor.cli --state-file /tmp/mac-mini-monitor-state.json
```

本機執行正式監控前請設定：

```bash
export NTFY_TOPIC="你的隨機-topic"
```

## 手動測試通知

```bash
python3 -m monitor.cli \
  --state-file /tmp/mac-mini-monitor-state.json \
  --test-notification
```

測試通知不會製造假商品，也不會重設既有商品狀態。
