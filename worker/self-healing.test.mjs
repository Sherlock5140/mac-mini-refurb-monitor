import assert from "node:assert/strict";
import test from "node:test";

import {
  circuitStatus,
  classifyMonitorError,
  runWithRetry,
  validateSnapshot,
} from "./self-healing.js";

test("classifies blocked, transient, parser, and invalid-data errors", () => {
  assert.equal(classifyMonitorError("HTTP 403 access denied"), "blocked");
  assert.equal(classifyMonitorError("network timeout"), "transient");
  assert.equal(classifyMonitorError("沒有辨識到商品卡片"), "parser_changed");
  assert.equal(classifyMonitorError("價格不可信"), "invalid_data");
});

test("retries transient failures and returns the recovered result", async () => {
  let attempts = 0;
  const result = await runWithRetry(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("network timeout");
    return "ok";
  });

  assert.equal(result, "ok");
  assert.equal(attempts, 2);
});

test("does not retry deterministic parser changes", async () => {
  let attempts = 0;
  await assert.rejects(
    runWithRetry(async () => {
      attempts += 1;
      throw new Error("頁面結構解析失敗");
    }),
    /解析失敗/,
  );
  assert.equal(attempts, 1);
});

test("opens a circuit after repeated errors and closes after cooldown", () => {
  const state = {
    consecutiveErrors: 6,
    lastRunAt: "2026-07-28T00:00:00.000Z",
  };
  assert.equal(
    circuitStatus(state, new Date("2026-07-28T00:10:00.000Z")).open,
    true,
  );
  assert.equal(
    circuitStatus(state, new Date("2026-07-28T00:31:00.000Z")).open,
    false,
  );
});

test("rejects empty, duplicate, invalid-price, and insecure snapshots", () => {
  assert.throws(
    () => validateSnapshot({ totalProductCount: 0, targetProducts: [] }),
    /商品數突然歸零/,
  );
  assert.throws(
    () => validateSnapshot({
      totalProductCount: 2,
      targetProducts: [
        { sku: "a", priceTwd: 1000, url: "https://example.com/a" },
        { sku: "a", priceTwd: 900, url: "https://example.com/b" },
      ],
    }),
    /識別碼缺失或重複/,
  );
  assert.throws(
    () => validateSnapshot({
      totalProductCount: 1,
      targetProducts: [
        { sku: "a", priceTwd: 0, url: "https://example.com/a" },
      ],
    }),
    /價格超出可信範圍/,
  );
  assert.throws(
    () => validateSnapshot({
      totalProductCount: 1,
      targetProducts: [
        { sku: "a", priceTwd: 1000, url: "http://example.com/a" },
      ],
    }),
    /不是 HTTPS/,
  );
});
