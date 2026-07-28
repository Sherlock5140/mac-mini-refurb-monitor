import assert from "node:assert/strict";
import test from "node:test";

import {
  assertVerifiedSourceUrl,
  formatVerifiedSources,
  sourceDisclosure,
} from "./source-verification.js";

test("accepts exact registered official hosts", () => {
  assert.equal(
    assertVerifiedSourceUrl(
      "apple",
      "https://www.apple.com/tw/shop/refurbished/mac",
    ).hostname,
    "www.apple.com",
  );
  assert.equal(
    assertVerifiedSourceUrl(
      "costco",
      "https://www.costco.com.tw/rest/v2/taiwan/products/search?query=%3Arelevance%3Acategory%3A20101",
    ).hostname,
    "www.costco.com.tw",
  );
  assert.equal(
    assertVerifiedSourceUrl(
      "tigerair",
      "https://www.tigerairtw.com/zh-TW/index",
    ).hostname,
    "www.tigerairtw.com",
  );
  assert.equal(
    assertVerifiedSourceUrl(
      "chatgptPromo",
      "https://github.com/JUk1-GH/gpt-promo-scanner",
    ).hostname,
    "github.com",
  );
  assert.equal(
    assertVerifiedSourceUrl(
      "doctorOfCredit",
      "https://www.doctorofcredit.com/chatgpt-get-two-business-seats-for-price-of-one-with-promo-code-infoseekaius-free-with-amex/",
    ).hostname,
    "www.doctorofcredit.com",
  );
});

test("rejects lookalike, insecure, and unregistered sources", () => {
  assert.throws(
    () => assertVerifiedSourceUrl(
      "apple",
      "https://www.apple.com.example.org/promo",
    ),
    /來源不符/,
  );
  assert.throws(
    () => assertVerifiedSourceUrl(
      "pchome",
      "http://24h.pchome.com.tw/search",
    ),
    /來源不符/,
  );
  assert.throws(
    () => assertVerifiedSourceUrl(
      "tigerair",
      "https://www.tigerairtw.com/zh-TW/EVENTS/2607tigeresg",
    ),
    /頁面指紋不符/,
  );
  assert.throws(
    () => assertVerifiedSourceUrl(
      "chatgptPromo",
      "https://github.com/JUk1-GH/gpt-promo-scanner-fake",
    ),
    /頁面指紋不符/,
  );
  assert.throws(
    () => assertVerifiedSourceUrl(
      "doctorOfCredit",
      "https://www.doctorofcredit.com/another-chatgpt-deal/",
    ),
    /頁面指紋不符/,
  );
});

test("rejects a different page or query on the same official host", () => {
  assert.throws(
    () => assertVerifiedSourceUrl(
      "apple",
      "https://www.apple.com/tw/shop/refurbished/iphone",
    ),
    /頁面指紋不符/,
  );
  assert.throws(
    () => assertVerifiedSourceUrl(
      "coupang",
      "https://www.tw.coupang.com/np/search?q=WH-1000XM6",
    ),
    /頁面指紋不符/,
  );
  assert.throws(
    () => assertVerifiedSourceUrl(
      "sony",
      "https://www.tw.coupang.com/np/search?q=mac%20mini%20m4",
    ),
    /頁面指紋不符/,
  );
});

test("formats private source provenance without inventing confidence", () => {
  const text = sourceDisclosure(
    "coupang",
    "https://www.tw.coupang.com/np/search?q=mac%20mini%20m4",
    "2026/7/28 20:00:00",
  );

  assert.match(text, /酷澎台灣官方網站/);
  assert.match(
    text,
    /原始網址：https:\/\/www\.tw\.coupang\.com\/np\/search\?q=mac%20mini%20m4/,
  );
  assert.match(text, /Browser Run/);
  assert.match(formatVerifiedSources(), /相似活動頁只能用於發現/);
});
