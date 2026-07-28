export const DOCTOR_OF_CREDIT_PROMO_URL =
  "https://www.doctorofcredit.com/chatgpt-get-two-business-seats-for-price-of-one-with-promo-code-infoseekaius-free-with-amex/";
export const DOCTOR_OF_CREDIT_API_URL =
  "https://www.doctorofcredit.com/wp-json/wp/v2/posts?slug=chatgpt-get-two-business-seats-for-price-of-one-with-promo-code-infoseekaius-free-with-amex&_fields=id,date,modified,link,title,content";

const EXPECTED_POST_ID = 258199;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeText(value, maxLength = 300) {
  return decodeHtml(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function assertDoctorOfCreditApiUrl(value) {
  const url = new URL(String(value ?? ""));
  const fields = new Set(
    (url.searchParams.get("_fields") ?? "").split(","),
  );
  const requiredFields = [
    "id", "date", "modified", "link", "title", "content",
  ];
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "www.doctorofcredit.com" ||
    url.pathname.toLowerCase() !== "/wp-json/wp/v2/posts" ||
    url.searchParams.get("slug") !==
      "chatgpt-get-two-business-seats-for-price-of-one-with-promo-code-infoseekaius-free-with-amex" ||
    requiredFields.some((field) => !fields.has(field)) ||
    [...url.searchParams.keys()].some(
      (key) => !["slug", "_fields"].includes(key),
    )
  ) {
    throw new Error("Doctor of Credit 公開 API 來源不符");
  }
  return url;
}

function assertArticleUrl(value) {
  const url = new URL(String(value ?? ""));
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "www.doctorofcredit.com" ||
    `${url.pathname.replace(/\/+$/, "")}/`.toLowerCase() !==
      new URL(DOCTOR_OF_CREDIT_PROMO_URL).pathname.toLowerCase() ||
    url.search ||
    url.hash
  ) {
    throw new Error("Doctor of Credit 文章網址不符");
  }
  return url;
}

function extractPromoCodes(html, title) {
  const values = [];
  const decoded = decodeHtml(html);
  for (const match of decoded.matchAll(
    /[?&]promoCode=([a-z0-9_-]{2,80})/gi,
  )) {
    values.push(match[1]);
  }
  const titleMatch = normalizeText(title).match(
    /\bpromo\s+code\s+([a-z0-9_-]{2,80})/i,
  );
  if (titleMatch) values.push(titleMatch[1]);
  return [...new Set(
    values.map((value) => value.toLowerCase()),
  )].sort();
}

export function parseDoctorOfCreditPromotion(payload) {
  const post = Array.isArray(payload) ? payload[0] : null;
  if (
    Number(post?.id) !== EXPECTED_POST_ID ||
    typeof post?.content?.rendered !== "string"
  ) {
    throw new Error("Doctor of Credit 找不到指定文章");
  }
  const url = assertArticleUrl(post.link);
  const title = normalizeText(post?.title?.rendered, 240);
  const publishedAt = normalizeText(post.date, 40);
  const modifiedAt = normalizeText(post.modified, 40);
  if (
    !title ||
    Number.isNaN(Date.parse(publishedAt)) ||
    Number.isNaN(Date.parse(modifiedAt))
  ) {
    throw new Error("Doctor of Credit 文章時間或標題無效");
  }
  const promoCodes = extractPromoCodes(
    post.content.rendered,
    post.title.rendered,
  );
  if (promoCodes.length === 0 || promoCodes.length > 100) {
    throw new Error("Doctor of Credit 文章沒有可辨識的公開優惠碼");
  }
  const expired = /^\s*\[expired\]/i.test(title);
  const item = {
    sku: `doctor-of-credit:${EXPECTED_POST_ID}`,
    name: title,
    title,
    status: expired ? "expired" : "active",
    promoCodes,
    publishedAt,
    modifiedAt,
    url: url.href,
    sourceStatus: "第三方公開文章，未經 OpenAI 官方驗證",
  };
  item.fingerprint = JSON.stringify([
    item.title,
    item.status,
    item.promoCodes,
    item.modifiedAt,
  ]);
  return {
    totalProductCount: 1,
    macProductCount: 0,
    macMiniCount: 0,
    targetProducts: [item],
    article: item,
  };
}

function statusLabel(item) {
  return item.status === "expired"
    ? "文章目前標示 Expired"
    : "文章目前未標示 Expired";
}

function eventFor(item, title) {
  return {
    kind: "article_update",
    title,
    message: [
      statusLabel(item),
      `文章：${item.title}`,
      `網站更新：${item.modifiedAt}`,
      `公開代碼：${item.promoCodes.join("、")}`,
      "",
      "第三方文章內容不代表目前帳號符合資格，使用前請核對 OpenAI 活動條款。",
    ].join("\n"),
    url: item.url,
    disablePreview: true,
  };
}

export function applyDoctorOfCreditUpdates(state, snapshot, nowIso) {
  const updated = clone(state);
  updated.products ??= {};
  const item = clone(snapshot.article);
  const stored = updated.products[item.sku];

  if (!updated.initialized || !stored) {
    updated.products[item.sku] = {
      ...item,
      present: true,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
    };
    updated.initialized = true;
    updated.consecutiveErrors = 0;
    updated.lastError = null;
    return { state: updated, events: [] };
  }

  const previousFingerprint = stored.fingerprint;
  const previousStatus = stored.status;
  Object.assign(stored, item, {
    present: true,
    lastSeenAt: nowIso,
  });
  updated.consecutiveErrors = 0;
  updated.lastError = null;
  if (previousFingerprint === item.fingerprint) {
    return { state: updated, events: [] };
  }
  const title = previousStatus !== item.status
    ? item.status === "expired"
      ? "⚠️ Doctor of Credit 優惠文章已標示失效"
      : "🟢 Doctor of Credit 優惠文章恢復有效標示"
    : "🔎 Doctor of Credit 優惠文章更新";
  return { state: updated, events: [eventFor(item, title)] };
}

export function buildDoctorOfCreditBaselineEvent(snapshot) {
  return eventFor(
    snapshot.article,
    "✅ Doctor of Credit 優惠文章監控已啟用",
  );
}

export function formatDoctorOfCreditSummary(snapshot, checkedAt) {
  const item = snapshot.article;
  return [
    "📰 Doctor of Credit ChatGPT Business 優惠追蹤",
    "",
    statusLabel(item),
    `文章：${item.title}`,
    `網站更新：${item.modifiedAt}`,
    `公開代碼：${item.promoCodes.join("、")}`,
    "狀態：第三方公開文章，未經 OpenAI 官方驗證",
    "",
    item.url,
    `查詢時間：${checkedAt}`,
  ].join("\n");
}
