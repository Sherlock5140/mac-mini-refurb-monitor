import assert from "node:assert/strict";
import test from "node:test";

import {
  APPLE_REFURB_URL,
  default as worker,
  formatInventorySummary,
  formatPurchaseMessage,
  parseAppleInventory,
  replyForCommand,
} from "./worker.js";

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

  assert.match(formatInventorySummary(snapshot), /Mac mini：1 項/);
  assert.match(formatInventorySummary(snapshot), new RegExp(APPLE_REFURB_URL));
  assert.match(formatPurchaseMessage(snapshot), /NT\$17,000/);
  assert.match(formatPurchaseMessage(snapshot), /fminita\/a/);
});

test("answers check commands with live Apple data", async () => {
  const fakeFetch = async () =>
    new Response(sampleHtml, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });

  const reply = await replyForCommand("/check", fakeFetch);

  assert.match(reply, /符合 M4 mini 256／512GB：1 項/);
  assert.match(reply, /購買頁/);
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
