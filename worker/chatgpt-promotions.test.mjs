import assert from "node:assert/strict";
import test from "node:test";

import { emptyMonitorState } from "./monitor-state.js";
import {
  applyChatgptPromoUpdates,
  assertChatgptPromoCommitsApiUrl,
  buildChatgptPromoBaselineEvent,
  formatChatgptPromoSummary,
  parseChatgptPromoCommit,
} from "./chatgpt-promotions.js";

const commit = {
  sha: "0123456789abcdef0123456789abcdef01234567",
  html_url:
    "https://github.com/JUk1-GH/gpt-promo-scanner/commit/0123456789abcdef0123456789abcdef01234567",
  commit: {
    message: "Update public code list\n\nmetadata refresh",
    committer: {
      date: "2026-07-29T01:00:00Z",
    },
  },
};

test("accepts only the exact public GitHub commit feed", () => {
  assert.equal(
    assertChatgptPromoCommitsApiUrl(
      "https://api.github.com/repos/JUk1-GH/gpt-promo-scanner/commits?path=known_codes.json&per_page=1",
    ).hostname,
    "api.github.com",
  );
  assert.throws(
    () => assertChatgptPromoCommitsApiUrl(
      "https://api.github.com/repos/evil/scanner/commits?path=known_codes.json&per_page=1",
    ),
    /來源不符/,
  );
});

test("parses commit metadata without exposing or validating promo codes", () => {
  const snapshot = parseChatgptPromoCommit([commit]);
  assert.equal(snapshot.targetProducts.length, 1);
  assert.equal(
    snapshot.targetProducts[0].sku,
    commit.sha,
  );
  assert.equal(
    snapshot.targetProducts[0].description,
    "known_codes.json 公開清單有新版本",
  );
  assert.match(
    snapshot.targetProducts[0].sourceStatus,
    /未經 OpenAI 官方驗證/,
  );
});

test("creates a quiet baseline then notifies one new commit exactly once", () => {
  const firstSnapshot = parseChatgptPromoCommit([commit]);
  const baseline = applyChatgptPromoUpdates(
    emptyMonitorState(),
    firstSnapshot.targetProducts,
    "2026-07-29T01:05:00.000Z",
  );
  const baselineEvent = buildChatgptPromoBaselineEvent(firstSnapshot);
  const next = {
    ...commit,
    sha: "89abcdef0123456789abcdef0123456789abcdef",
    html_url:
      "https://github.com/JUk1-GH/gpt-promo-scanner/commit/89abcdef0123456789abcdef0123456789abcdef",
    commit: {
      message: "Refresh public metadata",
      committer: { date: "2026-07-29T02:00:00Z" },
    },
  };
  const nextSnapshot = parseChatgptPromoCommit([next]);
  const changed = applyChatgptPromoUpdates(
    baseline.state,
    nextSnapshot.targetProducts,
    "2026-07-29T02:05:00.000Z",
  );
  const repeated = applyChatgptPromoUpdates(
    changed.state,
    nextSnapshot.targetProducts,
    "2026-07-29T02:35:00.000Z",
  );

  assert.equal(baseline.events.length, 0);
  assert.match(baselineEvent.title, /監控已啟用/);
  assert.equal(changed.events.length, 1);
  assert.equal(changed.events[0].kind, "community_update");
  assert.match(changed.events[0].message, /不會猜碼、試碼/);
  assert.equal(repeated.events.length, 0);
});

test("formats a private summary with an explicit unverified label", () => {
  const summary = formatChatgptPromoSummary(
    parseChatgptPromoCommit([commit]),
    "2026/7/29 09:30",
  );
  assert.match(summary, /社群情報，未經 OpenAI 官方驗證/);
  assert.match(summary, /不自動猜碼、試碼/);
  assert.match(summary, /查詢時間：2026\/7\/29 09:30/);
});
