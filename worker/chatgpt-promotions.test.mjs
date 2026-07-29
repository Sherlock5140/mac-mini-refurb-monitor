import assert from "node:assert/strict";
import test from "node:test";

import { emptyMonitorState } from "./monitor-state.js";
import {
  CHATGPT_PROMO_CATALOG_URL,
  applyChatgptPromoUpdates,
  assertChatgptPromoCatalogUrl,
  buildChatgptPromoBaselineEvent,
  formatChatgptPromoSummary,
  parseChatgptPromoQuery,
  parseChatgptPromoCatalog,
} from "./chatgpt-promotions.js";

const catalog = {
  last_updated: "2026-07-29",
  valid: {
    US: [
      {
        code: "publicus",
        price_usd: 20,
        duration_months: 48,
        company: "Public Company",
        discount_pct: 60,
      },
    ],
    JP: [
      {
        code: "publicjp",
        price_local: "¥3,050/月",
        price_usd: 19,
        company: "Public Japan",
        discount_pct: 60,
      },
    ],
  },
  expired: [
    {
      code: "oldgb",
      region: "GB",
      company: "Old Company",
      note: "已失效",
    },
  ],
};

test("accepts only the exact public catalog URL", () => {
  assert.equal(
    assertChatgptPromoCatalogUrl(CHATGPT_PROMO_CATALOG_URL).hostname,
    "raw.githubusercontent.com",
  );
  assert.throws(
    () => assertChatgptPromoCatalogUrl(
      "https://raw.githubusercontent.com/evil/scanner/main/known_codes.json",
    ),
    /來源不符/,
  );
});

test("parses valid and expired public catalog entries", () => {
  const snapshot = parseChatgptPromoCatalog(catalog);
  assert.equal(snapshot.lastUpdated, "2026-07-29");
  assert.equal(snapshot.validCount, 2);
  assert.equal(snapshot.expiredCount, 1);
  assert.equal(snapshot.regionCount, 2);
  assert.deepEqual(
    snapshot.targetProducts.map((item) => item.sku),
    ["GB:oldgb", "JP:publicjp", "US:publicus"],
  );
});

test("rejects malformed, duplicated, and oversized catalogs", () => {
  assert.throws(
    () => parseChatgptPromoCatalog({ valid: {}, expired: [] }),
    /更新日期無效/,
  );
  assert.throws(
    () => parseChatgptPromoCatalog({
      ...catalog,
      valid: {
        US: [catalog.valid.US[0], catalog.valid.US[0]],
      },
      expired: [],
    }),
    /重複項目/,
  );
  assert.throws(
    () => parseChatgptPromoCatalog({
      ...catalog,
      valid: {
        US: Array.from({ length: 501 }, (_, index) => ({
          code: `code${index}`,
          company: "Company",
        })),
      },
      expired: [],
    }),
    /項目數量異常/,
  );
});

test("notifies only a newly discovered code currently marked valid", () => {
  const firstSnapshot = parseChatgptPromoCatalog(catalog);
  const baseline = applyChatgptPromoUpdates(
    emptyMonitorState(),
    firstSnapshot,
    "2026-07-29T01:05:00.000Z",
  );
  const nextCatalog = structuredClone(catalog);
  nextCatalog.valid.US[0].price_usd = 18;
  nextCatalog.valid.US.push({
    code: "newus",
    company: "New Company",
    price_usd: 25,
  });
  nextCatalog.valid.JP = [];
  nextCatalog.expired.push({
    code: "publicus",
    region: "US",
    company: "Public Company",
  });
  nextCatalog.valid.US = nextCatalog.valid.US.filter(
    (item) => item.code !== "publicus",
  );
  const changed = applyChatgptPromoUpdates(
    baseline.state,
    parseChatgptPromoCatalog(nextCatalog),
    "2026-07-29T02:05:00.000Z",
  );
  const repeated = applyChatgptPromoUpdates(
    changed.state,
    parseChatgptPromoCatalog(nextCatalog),
    "2026-07-29T02:35:00.000Z",
  );

  assert.equal(baseline.events.length, 0);
  assert.equal(
    baseline.state.products["US:publicus"].recentEligible,
    false,
  );
  assert.equal(
    changed.state.products["US:newus"].recentEligible,
    true,
  );
  assert.equal(changed.events.length, 1);
  assert.match(changed.events[0].message, /新增：US｜newus/);
  assert.doesNotMatch(changed.events[0].message, /publicus/);
  assert.doesNotMatch(changed.events[0].message, /publicjp/);
  assert.equal(
    changed.state.products["US:publicus"].recentEligible,
    false,
  );
  assert.equal(
    changed.state.products["JP:publicjp"].recentEligible,
    false,
  );
  assert.equal(repeated.events.length, 0);
});

test("stores expired and changed records without sending promotion alerts", () => {
  const baseline = applyChatgptPromoUpdates(
    emptyMonitorState(),
    parseChatgptPromoCatalog(catalog),
    "2026-07-29T01:05:00.000Z",
  );
  const nextCatalog = structuredClone(catalog);
  nextCatalog.valid.US[0].price_usd = 18;
  nextCatalog.expired.push({
    code: "expiredjp",
    region: "JP",
    company: "Expired Japan",
  });
  const result = applyChatgptPromoUpdates(
    baseline.state,
    parseChatgptPromoCatalog(nextCatalog),
    "2026-07-29T02:05:00.000Z",
  );

  assert.equal(result.events.length, 0);
  assert.equal(
    result.state.products["JP:expiredjp"].recentEligible,
    false,
  );
  assert.equal(
    result.state.products["US:publicus"].priceUsd,
    18,
  );
});

test("parses recent, regional, and explicit full catalog queries", () => {
  assert.deepEqual(parseChatgptPromoQuery("/gptpromo"), {
    region: "",
    includeAll: false,
    maxAgeHours: 168,
  });
  assert.deepEqual(parseChatgptPromoQuery("/gptpromo US 3d"), {
    region: "US",
    includeAll: false,
    maxAgeHours: 72,
  });
  assert.deepEqual(parseChatgptPromoQuery("/gptpromo all"), {
    region: "",
    includeAll: true,
    maxAgeHours: 168,
  });
  assert.throws(
    () => parseChatgptPromoQuery("/gptpromo 31d"),
    /1 小時至 30 天/,
  );
});

test("recent summary excludes the old baseline and expired time window", () => {
  const snapshot = parseChatgptPromoCatalog(catalog);
  const state = applyChatgptPromoUpdates(
    emptyMonitorState(),
    snapshot,
    "2026-07-20T01:00:00.000Z",
  ).state;
  const recentCatalog = structuredClone(catalog);
  recentCatalog.valid.US.push({
    code: "freshus",
    company: "Fresh Company",
    price_usd: 25,
  });
  const updatedSnapshot = parseChatgptPromoCatalog(recentCatalog);
  const updatedState = applyChatgptPromoUpdates(
    state,
    updatedSnapshot,
    "2026-07-29T01:00:00.000Z",
  ).state;
  const recent = formatChatgptPromoSummary(
    updatedSnapshot,
    "2026/7/29 09:30",
    "",
    {
      products: updatedState.products,
      includeAll: false,
      maxAgeHours: 168,
      nowIso: "2026-07-29T02:00:00.000Z",
    },
  );
  const all = formatChatgptPromoSummary(
    updatedSnapshot,
    "2026/7/29 09:30",
    "",
    {
      products: updatedState.products,
      includeAll: true,
      nowIso: "2026-07-29T02:00:00.000Z",
    },
  );

  assert.match(recent, /最近 7 天新發現/);
  assert.match(recent, /freshus/);
  assert.doesNotMatch(recent, /publicus/);
  assert.doesNotMatch(recent, /oldgb/);
  assert.match(all, /完整公開清單/);
  assert.match(all, /publicus/);
  assert.match(all, /oldgb/);
});

test("does not promote changed metadata on an existing public code", () => {
  const first = parseChatgptPromoCatalog(catalog);
  const baseline = applyChatgptPromoUpdates(
    emptyMonitorState(),
    first,
    "2026-07-29T01:05:00.000Z",
  );
  const nextCatalog = structuredClone(catalog);
  nextCatalog.valid.US[0].price_usd = 18;
  const changed = applyChatgptPromoUpdates(
    baseline.state,
    parseChatgptPromoCatalog(nextCatalog),
    "2026-07-29T01:35:00.000Z",
  );

  assert.equal(changed.events.length, 0);
});

test("formats all regions or one requested region within Telegram limits", () => {
  const snapshot = parseChatgptPromoCatalog(catalog);
  const all = formatChatgptPromoSummary(
    snapshot,
    "2026/7/29 09:30",
  );
  const us = formatChatgptPromoSummary(
    snapshot,
    "2026/7/29 09:30",
    "us",
  );
  const baseline = buildChatgptPromoBaselineEvent(snapshot);

  assert.match(all, /【JP】/);
  assert.match(all, /【US】/);
  assert.match(all, /oldgb.*已列為失效/);
  assert.match(us, /地區：US/);
  assert.match(us, /publicus/);
  assert.doesNotMatch(us, /publicjp/);
  assert.ok(all.length < 4_096);
  assert.match(baseline.message, /公開有效項目：2 項/);
  assert.match(baseline.message, /只有首次發現且清單當下標示有效/);
});
