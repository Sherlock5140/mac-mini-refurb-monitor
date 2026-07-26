import assert from "node:assert/strict";
import test from "node:test";

import {
  APPLE_REFURB_URL,
  buildTestNotificationEvent,
  default as worker,
  formatInventorySummary,
  formatPurchaseMessage,
  parseAppleInventory,
  replyForCommand,
} from "./worker.js";
import {
  applyInventory,
  applyMonitorError,
  emptyMonitorState,
  recoveryEvent,
} from "./monitor-state.js";

function product({
  name,
  description = "16GB 統一記憶體 256GB SSD",
  sku,
  price = 17000,
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    description,
    url: `https://www.apple.com/tw/shop/product/${sku.toLowerCase()}`,
    offers: {
      "@type": "Offer",
      sku,
      price,
      priceCurrency: "TWD",
    },
  };
}

function htmlFor(...products) {
  return products
    .map(
      (item) =>
        `<script type="application/ld+json">${JSON.stringify(item)}</script>`,
    )
    .join("");
}

const sampleHtml = htmlFor(
  product({
    name: "Mac mini Apple M4 晶片配備 10 核心 CPU (整修品)",
    sku: "FMINITA/A",
  }),
  product({
    name: "24 吋 iMac Apple M4 晶片 (整修品)",
    sku: "FIMACTA/A",
  }),
  product({
    name: "14 吋 MacBook Pro Apple M4 Pro 晶片 (整修品)",
    sku: "FMBPTA/A",
  }),
);

test("parses broad Mac counts while filtering target Mac minis", () => {
  const snapshot = parseAppleInventory(sampleHtml);

  assert.equal(snapshot.totalProductCount, 3);
  assert.equal(snapshot.macProductCount, 3);
  assert.equal(snapshot.macMiniCount, 1);
  assert.equal(snapshot.targetProducts.length, 1);
  assert.deepEqual(Object.fromEntries(snapshot.deviceCounts), {
    "Mac mini": 1,
    "MacBook Pro": 1,
    iMac: 1,
  });
});

test("formats inventory and purchase links", () => {
  const snapshot = parseAppleInventory(sampleHtml);
  const summary = formatInventorySummary(snapshot);

  assert.match(summary, /符合條件：1 項/);
  assert.match(summary, /Mac mini 總數：1 項/);
  assert.match(summary, /• MacBook Pro：1 項/);
  assert.match(summary, new RegExp(APPLE_REFURB_URL));
  assert.ok(
    summary.indexOf("🎯 監控結果") <
      summary.indexOf("📊 頁面概況"),
  );
  assert.match(formatPurchaseMessage(snapshot), /NT\$17,000/);
  assert.match(formatPurchaseMessage(snapshot), /fminita\/a/);
});

test("backend test notifications contain one compact purchase link", () => {
  const event = buildTestNotificationEvent(
    parseAppleInventory(sampleHtml),
  );
  const finalText = `${event.title}\n\n${event.message}\n\n${event.url}`;
  const linkMatches = finalText.match(
    new RegExp(APPLE_REFURB_URL, "g"),
  );

  assert.equal(linkMatches.length, 1);
  assert.equal(event.disablePreview, true);
  assert.doesNotMatch(event.message, /購買頁/);
  assert.ok(
    event.message.indexOf("✅ 主動通知通道") <
      event.message.indexOf("🎯 監控結果"),
  );
});

test("answers check commands with live Apple data", async () => {
  const fakeFetch = async () =>
    new Response(sampleHtml, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });

  const reply = await replyForCommand("/check", fakeFetch);

  assert.match(reply, /符合條件：1 項/);
  assert.match(reply, /標準版 M4｜256／512GB SSD/);
  assert.match(reply, /購買頁/);
});

test("reports Cloudflare scheduler state in status commands", async () => {
  const fakeFetch = async () =>
    new Response(sampleHtml, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });

  const reply = await replyForCommand(
    "/status",
    fakeFetch,
    async () => ({
      lastSuccessAt: "2026-07-26T07:25:31.203Z",
      consecutiveErrors: 0,
    }),
  );

  assert.match(reply, /Cloudflare 排程：正常/);
  assert.match(reply, /每 5 分鐘執行/);
  assert.doesNotMatch(reply, /GitHub Actions/);
});

test("lists the active notification test command", async () => {
  const reply = await replyForCommand("/help");

  assert.match(reply, /\/test－傳送一則 Cloudflare 主動通知測試/);
});

test("rejects a product page that contains no Mac", () => {
  const iphoneHtml = htmlFor(
    product({
      name: "iPhone 17 Pro 256GB (整修品)",
      description: "256GB",
      sku: "FIPHONE/A",
    }),
  );

  assert.throws(() => parseAppleInventory(iphoneHtml), /沒有辨識到任何 Mac/);
});

test("rejects webhook requests without the Telegram secret header", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/telegram", {
      method: "POST",
      body: JSON.stringify({ message: { text: "/check" } }),
    }),
    { TELEGRAM_WEBHOOK_SECRET: "expected-secret" },
    { waitUntil() {} },
  );

  assert.equal(response.status, 401);
});

test("rejects backend notification tests without the admin token", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/admin/test", {
      method: "POST",
    }),
    { ADMIN_TEST_TOKEN: "expected-secret" },
    { waitUntil() {} },
  );

  assert.equal(response.status, 401);
});

function target({
  sku = "FMINITA/A",
  priceTwd = 17000,
} = {}) {
  return {
    sku,
    name: "Mac mini Apple M4 晶片 (整修品)",
    storageGb: 256,
    memoryGb: 16,
    priceTwd,
    url: `https://www.apple.com/tw/shop/product/${sku.toLowerCase()}`,
  };
}

test("Cloudflare first run creates a baseline without an alert", () => {
  const result = applyInventory(
    emptyMonitorState(),
    [target()],
    "2026-07-26T10:00:00.000Z",
  );

  assert.equal(result.state.initialized, true);
  assert.deepEqual(result.events, []);
});

test("Cloudflare detects new, restocked, and cheaper products", () => {
  let result = applyInventory(
    emptyMonitorState(),
    [],
    "2026-07-26T10:00:00.000Z",
  );
  result = applyInventory(
    result.state,
    [target()],
    "2026-07-26T10:05:00.000Z",
  );
  assert.deepEqual(result.events.map((item) => item.kind), ["new"]);

  result = applyInventory(
    result.state,
    [],
    "2026-07-26T10:10:00.000Z",
  );
  assert.deepEqual(result.events, []);
  result = applyInventory(
    result.state,
    [],
    "2026-07-26T10:15:00.000Z",
  );
  assert.deepEqual(result.events.map((item) => item.kind), ["removed"]);

  result = applyInventory(
    result.state,
    [target()],
    "2026-07-26T10:20:00.000Z",
  );
  assert.deepEqual(result.events.map((item) => item.kind), ["restock"]);

  result = applyInventory(
    result.state,
    [target({ priceTwd: 16000 })],
    "2026-07-26T10:25:00.000Z",
  );
  assert.deepEqual(result.events.map((item) => item.kind), ["price_drop"]);
});

test("Cloudflare confirms removal twice and resets a single miss", () => {
  let result = applyInventory(
    emptyMonitorState(),
    [target()],
    "2026-07-26T10:00:00.000Z",
  );
  result = applyInventory(
    result.state,
    [],
    "2026-07-26T10:05:00.000Z",
  );
  result = applyInventory(
    result.state,
    [target()],
    "2026-07-26T10:10:00.000Z",
  );

  assert.equal(result.state.products["FMINITA/A"].missingCount, 0);
  assert.deepEqual(result.events, []);
});

test("Cloudflare throttles errors and reports recovery", () => {
  let state = emptyMonitorState();
  const emitted = [];
  for (let index = 0; index < 7; index += 1) {
    const result = applyMonitorError(
      state,
      "temporary failure",
      `2026-07-26T10:${index}0:00.000Z`,
    );
    state = result.state;
    emitted.push(...result.events.map((item) => item.kind));
  }

  assert.deepEqual(emitted, ["error", "error", "error"]);
  assert.equal(recoveryEvent(7).kind, "recovered");
  assert.equal(recoveryEvent(0), null);
});
