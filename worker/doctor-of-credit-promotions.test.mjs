import assert from "node:assert/strict";
import test from "node:test";

import { emptyMonitorState } from "./monitor-state.js";
import {
  DOCTOR_OF_CREDIT_API_URL,
  applyDoctorOfCreditUpdates,
  assertDoctorOfCreditApiUrl,
  buildDoctorOfCreditBaselineEvent,
  formatDoctorOfCreditSummary,
  parseDoctorOfCreditPromotion,
} from "./doctor-of-credit-promotions.js";

const article = {
  id: 258199,
  date: "2026-07-24T11:16:08",
  modified: "2026-07-24T17:36:46",
  link:
    "https://www.doctorofcredit.com/chatgpt-get-two-business-seats-for-price-of-one-with-promo-code-infoseekaius-free-with-amex/",
  title: {
    rendered:
      "[Expired] ChatGPT: Get Two Business Seats For Price Of One With Promo Code AGT (Free With Amex)",
  },
  content: {
    rendered: [
      '<p>Update: <a href="https://chatgpt.com/?promoCode=AGT">link</a></p>',
      '<p>Older <a href="https://chatgpt.com/?promoCode=factspanus">link</a></p>',
    ].join(""),
  },
};

test("accepts only the exact Doctor of Credit public API", () => {
  assert.equal(
    assertDoctorOfCreditApiUrl(DOCTOR_OF_CREDIT_API_URL).hostname,
    "www.doctorofcredit.com",
  );
  assert.throws(
    () => assertDoctorOfCreditApiUrl(
      "https://www.doctorofcredit.com/wp-json/wp/v2/posts?slug=other&_fields=id,date,modified,link,title,content",
    ),
    /來源不符/,
  );
});

test("parses the exact article, expiry status, and public codes", () => {
  const snapshot = parseDoctorOfCreditPromotion([article]);
  assert.equal(snapshot.article.status, "expired");
  assert.deepEqual(snapshot.article.promoCodes, ["agt", "factspanus"]);
  assert.equal(snapshot.article.modifiedAt, "2026-07-24T17:36:46");
});

test("rejects a different article or an article without public codes", () => {
  assert.throws(
    () => parseDoctorOfCreditPromotion([{ ...article, id: 1 }]),
    /找不到指定文章/,
  );
  assert.throws(
    () => parseDoctorOfCreditPromotion([{
      ...article,
      title: { rendered: "[Expired] ChatGPT offer" },
      content: { rendered: "<p>No public link</p>" },
    }]),
    /沒有可辨識/,
  );
});

test("creates one baseline and one update without duplicate alerts", () => {
  const first = parseDoctorOfCreditPromotion([article]);
  const baseline = applyDoctorOfCreditUpdates(
    emptyMonitorState(),
    first,
    "2026-07-29T01:00:00.000Z",
  );
  const updatedArticle = {
    ...article,
    modified: "2026-07-29T08:00:00",
    title: {
      rendered:
        "ChatGPT: Get Two Business Seats For Price Of One With Promo Code NEWUS",
    },
    content: {
      rendered:
        '<p><a href="https://chatgpt.com/?promoCode=NEWUS">new</a></p>',
    },
  };
  const changedSnapshot = parseDoctorOfCreditPromotion([updatedArticle]);
  const changed = applyDoctorOfCreditUpdates(
    baseline.state,
    changedSnapshot,
    "2026-07-29T08:05:00.000Z",
  );
  const repeated = applyDoctorOfCreditUpdates(
    changed.state,
    changedSnapshot,
    "2026-07-29T08:35:00.000Z",
  );

  assert.equal(baseline.events.length, 0);
  assert.match(
    buildDoctorOfCreditBaselineEvent(first).message,
    /文章目前標示 Expired/,
  );
  assert.equal(changed.events.length, 1);
  assert.match(changed.events[0].title, /恢復有效標示/);
  assert.equal(repeated.events.length, 0);
});

test("formats an immediate private summary", () => {
  const summary = formatDoctorOfCreditSummary(
    parseDoctorOfCreditPromotion([article]),
    "2026/7/29 09:30",
  );
  assert.match(summary, /文章目前標示 Expired/);
  assert.match(summary, /agt、factspanus/);
  assert.match(summary, /未經 OpenAI 官方驗證/);
});
