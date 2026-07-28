export const TIGERAIR_HOME_URL =
  "https://www.tigerairtw.com/zh-TW/index";
export const TIGERAIR_BANNERS_API_URL =
  "https://api-cms.tigerairtw.com/api/home-banners?language=zh-TW&perPage=100";
export const TIGERAIR_TIME_ZONE = "Asia/Taipei";

const PROMOTION_TERMS =
  /促銷|優惠|特惠|開賣|快閃|折扣|未稅|(?:TWD|NT\$?)\s*[\d,]+\s*起|\d+(?:\.\d+)?\s*折|票價.*起|機票.*(?:起|優惠)/i;
const EXCLUDED_TERMS =
  /飯店|公寓|住宿|藥妝|接送|租車|行李|eSIM|wifi|網卡|免稅|購物|保險|聯名商品|周邊|紀念品|品牌合作|信用卡|聯名卡|銀行|刷卡|卡友|持卡|Visa|Mastercard|JCB/i;

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCodePoint(Number(code))
    );
}

function normalizeText(value) {
  return decodeHtml(
    String(value ?? "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html, key) {
  const patterns = [
    new RegExp(
      `<meta\\b[^>]*(?:name|property)=["']${key}["'][^>]*content=["']([^"']*)["'][^>]*>`,
      "i",
    ),
    new RegExp(
      `<meta\\b[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["']${key}["'][^>]*>`,
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const match = String(html ?? "").match(pattern);
    if (match) return normalizeText(match[1]);
  }
  return "";
}

function titleText(html) {
  return normalizeText(
    String(html ?? "").match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1],
  );
}

function anchorRows(html) {
  const rows = [];
  const pattern =
    /<a\b([^>]*\bhref=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of String(html ?? "").matchAll(pattern)) {
    rows.push({
      href: decodeHtml(match[2]),
      text: normalizeText(match[3]),
      attributes: match[1],
    });
  }
  return rows;
}

function normalizedUrl(value, base = TIGERAIR_HOME_URL) {
  const url = new URL(String(value ?? ""), base);
  url.hash = "";
  return url;
}

export function assertTigerairOfferUrl(value) {
  let url;
  try {
    url = normalizedUrl(value);
  } catch {
    throw new Error("虎航優惠連結無效");
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase().replace(/\/+$/, "");
  const allowed =
    (
      host === "www.tigerairtw.com" &&
      (
        path.startsWith("/zh-tw/news/") ||
        path.startsWith("/zh-tw/events/")
      )
    ) ||
    (
      host === "static.tigerairtw.com" &&
      path.startsWith("/www/events/")
    ) ||
    (
      host === "booking.tigerairtw.com" &&
      path.startsWith("/zh-tw/portal/")
    );
  if (url.protocol !== "https:" || !allowed) {
    throw new Error(`虎航優惠連結來源不符：${host || "unknown"}`);
  }
  return url;
}

export function assertTigerairBannerFeedUrl(value) {
  const url = new URL(String(value ?? ""));
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "api-cms.tigerairtw.com" ||
    url.pathname !== "/api/home-banners" ||
    url.searchParams.get("language") !== "zh-TW" ||
    url.searchParams.get("perPage") !== "100"
  ) {
    throw new Error("虎航首頁輪播來源不符");
  }
  return url;
}

function offerId(url) {
  return url.href.toLowerCase().replace(/\/+$/, "");
}

function offerFingerprint(offer) {
  return [
    offer.name,
    offer.description,
    offer.url,
    offer.kind,
    offer.imageUrl ?? "",
    offer.saleStartAt ?? "",
    offer.saleEndAt ?? "",
  ].join("|");
}

function promotion({
  name,
  description = "",
  url,
  kind,
  imageUrl = null,
}) {
  const verifiedUrl = assertTigerairOfferUrl(url);
  let verifiedImageUrl = null;
  if (imageUrl) {
    const candidate = new URL(imageUrl);
    if (
      candidate.protocol === "https:" &&
      candidate.hostname.toLowerCase() ===
        "strapi-assets.tigerairtw.com"
    ) {
      verifiedImageUrl = candidate.href;
    }
  }
  const item = {
    sku: offerId(verifiedUrl),
    name: normalizeText(name).slice(0, 240),
    description: normalizeText(description).slice(0, 500),
    details: kind === "official-event"
      ? "台灣虎航官方促銷活動"
      : "台灣虎航官網優惠消息",
    url: verifiedUrl.href,
    kind,
    imageUrl: verifiedImageUrl,
  };
  item.fingerprint = offerFingerprint(item);
  return item;
}

export function parseTigerairHomepage(html) {
  const source = String(html ?? "");
  if (
    !source.includes("最新活動推薦") ||
    !source.includes("最新消息")
  ) {
    throw new Error("虎航官方首頁沒有可驗證的活動區塊");
  }

  const detailUrls = [];
  const promotions = [];
  const seen = new Set();
  const addPromotion = (item) => {
    if (seen.has(item.sku)) return;
    seen.add(item.sku);
    promotions.push(item);
  };

  for (const row of anchorRows(source)) {
    let url;
    try {
      url = normalizedUrl(row.href);
    } catch {
      continue;
    }
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    const isDetailCandidate =
      (
        host === "www.tigerairtw.com" &&
        path.startsWith("/zh-tw/events/")
      ) ||
      (
        host === "static.tigerairtw.com" &&
        path.startsWith("/www/events/")
      );
    if (isDetailCandidate) {
      const verified = assertTigerairOfferUrl(url.href).href;
      if (!detailUrls.includes(verified)) detailUrls.push(verified);
      continue;
    }

    const isOfficialNews =
      host === "www.tigerairtw.com" &&
      path.startsWith("/zh-tw/news/");
    if (
      !row.text ||
      EXCLUDED_TERMS.test(row.text) ||
      !PROMOTION_TERMS.test(row.text) ||
      !isOfficialNews
    ) {
      continue;
    }
    addPromotion(promotion({
      name: row.text,
      url: url.href,
      kind: "official-news",
    }));
  }

  return {
    promotions,
    detailUrls: detailUrls.slice(0, 4),
  };
}

export function parseTigerairBannerFeed(payload) {
  const banners = payload?.data?.homeBanners?.data;
  if (!Array.isArray(banners)) {
    throw new Error("虎航首頁輪播資料格式無法辨識");
  }
  const detailUrls = [];
  for (const banner of banners) {
    const candidate = banner?.attributes?.linkTo?.url;
    if (!candidate) continue;
    try {
      const verified = assertTigerairOfferUrl(candidate);
      const host = verified.hostname.toLowerCase();
      const path = verified.pathname.toLowerCase();
      const isOfficialEvent =
        (
          host === "www.tigerairtw.com" &&
          path.startsWith("/zh-tw/events/")
        ) ||
        (
          host === "static.tigerairtw.com" &&
          path.startsWith("/www/events/")
        );
      if (
        isOfficialEvent &&
        !detailUrls.includes(verified.href)
      ) {
        detailUrls.push(verified.href);
      }
    } catch {
      // Homepage banners may legitimately link to unrelated partners.
    }
  }
  if (banners.length > 0 && detailUrls.length === 0) {
    throw new Error("虎航首頁輪播沒有可驗證的官方活動連結");
  }
  return detailUrls.slice(0, 4);
}

export function parseTigerairPromotionDetail(html, pageUrl) {
  const url = assertTigerairOfferUrl(pageUrl);
  const title =
    metaContent(html, "og:title") ||
    metaContent(html, "twitter:title") ||
    titleText(html);
  const description =
    metaContent(html, "og:description") ||
    metaContent(html, "description");
  const imageUrl =
    metaContent(html, "og:image") ||
    metaContent(html, "twitter:image");
  const evidence = `${title} ${description}`;
  if (
    !title ||
    EXCLUDED_TERMS.test(`${title} ${description}`) ||
    !PROMOTION_TERMS.test(evidence)
  ) {
    return null;
  }
  return promotion({
    name: title,
    description,
    url: url.href,
    kind: "official-event",
    imageUrl,
  });
}

export function tigerairSnapshot(homeHtml, detailPages = []) {
  const parsed = parseTigerairHomepage(homeHtml);
  const promotions = [...parsed.promotions];
  const seen = new Set(promotions.map((item) => item.sku));
  for (const detail of detailPages) {
    const item = parseTigerairPromotionDetail(
      detail.html,
      detail.url,
    );
    if (!item || seen.has(item.sku)) continue;
    seen.add(item.sku);
    promotions.unshift(item);
  }
  return {
    totalProductCount:
      promotions.length + parsed.detailUrls.length,
    macProductCount: 0,
    macMiniCount: 0,
    targetProducts: promotions,
    detailUrls: parsed.detailUrls,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function notification(kind, item) {
  return {
    kind,
    title: kind === "promotion_updated"
      ? "🐯 虎航優惠公告更新"
      : "🐯 虎航新優惠公告",
    message: formatTigerairPromotionMessage(item),
    url: item.url,
    disablePreview: false,
  };
}

export function applyTigerairPromotions(
  state,
  currentPromotions,
  nowIso,
) {
  const updated = clone(state);
  updated.products ??= {};
  const events = [];
  const current = new Set();

  for (const item of currentPromotions) {
    current.add(item.sku);
    const stored = updated.products[item.sku];
    if (!stored) {
      updated.products[item.sku] = {
        ...clone(item),
        present: true,
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
      };
      if (updated.initialized) {
        events.push(notification("new_promotion", item));
      }
      continue;
    }
    const changed = stored.fingerprint !== item.fingerprint;
    const saleStartChanged =
      String(stored.saleStartAt ?? "") !==
      String(item.saleStartAt ?? "");
    Object.assign(stored, clone(item), {
      present: true,
      lastSeenAt: nowIso,
    });
    if (saleStartChanged) {
      stored.saleOpenNotifiedAt = null;
    }
    if (changed) {
      events.push(notification("promotion_updated", item));
    }
  }

  for (const [sku, stored] of Object.entries(updated.products)) {
    if (!current.has(sku)) stored.present = false;
  }
  updated.initialized = true;
  updated.consecutiveErrors = 0;
  updated.lastError = null;

  const entries = Object.entries(updated.products);
  if (entries.length > 200) {
    entries
      .sort(([, a], [, b]) =>
        String(b.lastSeenAt ?? "").localeCompare(
          String(a.lastSeenAt ?? ""),
        )
      )
      .slice(200)
      .forEach(([sku]) => delete updated.products[sku]);
  }
  return { state: updated, events };
}

function taipeiLocalIso(dateText, timeText) {
  const dateMatch = String(dateText).match(
    /^(\d{4})-(\d{2})-(\d{2})$/,
  );
  const timeMatch = String(timeText).match(
    /^(\d{2}):(\d{2})$/,
  );
  if (!dateMatch || !timeMatch) return null;
  const [, year, month, day] = dateMatch;
  const [, hour, minute] = timeMatch;
  const parts = [
    Number(year),
    Number(month),
    Number(day),
    Number(hour),
    Number(minute),
  ];
  if (
    parts.some((value) => !Number.isInteger(value)) ||
    parts[1] < 1 ||
    parts[1] > 12 ||
    parts[2] < 1 ||
    parts[2] > 31 ||
    parts[3] > 23 ||
    parts[4] > 59
  ) {
    return null;
  }
  const iso = new Date(
    `${year}-${month}-${day}T${hour}:${minute}:00+08:00`,
  );
  if (Number.isNaN(iso.getTime())) return null;
  const local = new Date(iso.getTime() + 8 * 60 * 60 * 1000);
  if (
    local.getUTCFullYear() !== Number(year) ||
    local.getUTCMonth() + 1 !== Number(month) ||
    local.getUTCDate() !== Number(day) ||
    local.getUTCHours() !== Number(hour) ||
    local.getUTCMinutes() !== Number(minute)
  ) {
    return null;
  }
  return iso.toISOString();
}

function scheduleValue(text, key) {
  const normalized = String(text ?? "")
    .replace(/[／]/g, "-")
    .replace(/[：]/g, ":");
  const match = normalized.match(
    new RegExp(
      `${key}\\s*=\\s*(\\d{4})[-/](\\d{1,2})[-/](\\d{1,2})\\s+(\\d{1,2}):(\\d{2})`,
      "i",
    ),
  );
  if (!match) return null;
  return taipeiLocalIso(
    [
      match[1],
      match[2].padStart(2, "0"),
      match[3].padStart(2, "0"),
    ].join("-"),
    [
      match[4].padStart(2, "0"),
      match[5].padStart(2, "0"),
    ].join(":"),
  );
}

export function parseTigerairSaleScheduleText(text) {
  const saleStartAt = scheduleValue(text, "SALE_START");
  if (!saleStartAt) return null;
  const saleEndAt = scheduleValue(text, "SALE_END");
  const travelStartAt = scheduleValue(text, "TRAVEL_START");
  const travelEndAt = scheduleValue(text, "TRAVEL_END");
  if (
    saleEndAt &&
    Date.parse(saleEndAt) < Date.parse(saleStartAt)
  ) {
    return null;
  }
  return {
    saleStartAt,
    saleEndAt,
    travelStartAt,
    travelEndAt,
  };
}

export function withTigerairSaleSchedule(
  item,
  schedule,
  checkedAt,
) {
  const updated = {
    ...clone(item),
    ...(schedule ?? {}),
    saleScheduleCheckedAt: checkedAt,
    saleScheduleSource: schedule
      ? "official-image-workers-ai"
      : "not-found",
  };
  updated.fingerprint = offerFingerprint(updated);
  return updated;
}

export function formatTigerairTaipeiTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "時間格式錯誤";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: TIGERAIR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date).replace(/\s+/g, " ");
}

function taipeiDateParts(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIGERAIR_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const valueOf = (type) =>
    parts.find((part) => part.type === type)?.value;
  return {
    year: Number(valueOf("year")),
    month: Number(valueOf("month")),
    day: Number(valueOf("day")),
    hour: valueOf("hour"),
    minute: valueOf("minute"),
  };
}

function compactDateTime(value, { dateOnly = false } = {}) {
  const parts = taipeiDateParts(value);
  if (!parts) return null;
  const date = `${parts.year}/${parts.month}/${parts.day}`;
  return dateOnly
    ? date
    : `${date} ${parts.hour}:${parts.minute}`;
}

function compactPeriod(startAt, endAt, { dateOnly = false } = {}) {
  const start = compactDateTime(startAt, { dateOnly });
  const end = compactDateTime(endAt, { dateOnly });
  if (!start) return "以官方公告為準";
  if (!end) return `${start} 起`;
  if (dateOnly) return `${start}～${end}`;
  const startParts = taipeiDateParts(startAt);
  const endParts = taipeiDateParts(endAt);
  const sameDate =
    startParts &&
    endParts &&
    startParts.year === endParts.year &&
    startParts.month === endParts.month &&
    startParts.day === endParts.day;
  return sameDate
    ? `${start}–${endParts.hour}:${endParts.minute}`
    : `${start}–${end}`;
}

function tigerairFareAndRoute(item) {
  const evidence = normalizeText(
    `${item.name ?? ""} ${item.description ?? ""}`,
  );
  const price = evidence.match(
    /(?:TWD|NT\$?)\s*[\d,]+(?:\s*元)?(?:\s*起)?/i,
  )?.[0];
  const route = /全航線/.test(evidence)
    ? "全航線"
    : "活動指定航線";
  return [price || "票價以官方公告為準", route].join("／");
}

export function formatTigerairPromotionMessage(item) {
  return [
    `活動：${normalizeText(item.name)}`,
    `銷售：${compactPeriod(
      item.saleStartAt,
      item.saleEndAt,
    )}`,
    `旅遊期間：${compactPeriod(
      item.travelStartAt,
      item.travelEndAt,
      { dateOnly: true },
    )}`,
    `票價／航線：${tigerairFareAndRoute(item)}`,
  ].join("\n");
}

export function applyTigerairSaleOpenReminders(
  state,
  nowIso,
  { graceMinutes = 120 } = {},
) {
  const updated = clone(state);
  updated.products ??= {};
  const events = [];
  const now = Date.parse(nowIso);
  if (Number.isNaN(now)) {
    throw new Error("虎航開賣提醒檢查時間無效");
  }

  for (const item of Object.values(updated.products)) {
    const saleStart = Date.parse(item.saleStartAt ?? "");
    if (
      Number.isNaN(saleStart) ||
      item.saleOpenNotifiedAt ||
      now < saleStart ||
      now - saleStart > graceMinutes * 60 * 1000
    ) {
      continue;
    }
    item.saleOpenNotifiedAt = nowIso;
    events.push({
      kind: "sale_open",
      title: "⏰ 台灣虎航優惠開始販售",
      message: [
        item.name,
        "",
        `開賣時間：${formatTigerairTaipeiTime(
          item.saleStartAt,
        )}`,
        "現在可前往官方頁面查看並購票。",
      ].join("\n"),
      url: item.url,
      disablePreview: false,
    });
  }
  return { state: updated, events };
}

export function buildTigerairBaselineEvent(snapshot) {
  const promotions = snapshot.targetProducts.slice(0, 5);
  if (!promotions.length) return null;
  return {
    kind: "baseline",
    title: "✅ 台灣虎航優惠監控已啟用",
    message: [
      "已建立官方來源基準，之後只推播新增或更新。",
      "",
      ...promotions.flatMap((item, index) => [
        `${index + 1}. ${item.name}`,
        item.url,
      ]),
    ].join("\n"),
    url: promotions[0].url,
    disablePreview: false,
  };
}

export function formatTigerairSummary(snapshot, verifiedAt) {
  const promotions = snapshot.targetProducts.slice(0, 8);
  return [
    "✈️ 台灣虎航官方優惠",
    "",
    `目前辨識：${snapshot.targetProducts.length} 項`,
    ...(promotions.length
      ? promotions.flatMap((item, index) => [
          "",
          `${index + 1}. ${item.name}`,
          ...(item.description ? [item.description] : []),
          ...(item.saleStartAt
            ? [
                `開賣：${formatTigerairTaipeiTime(
                  item.saleStartAt,
                )}`,
              ]
            : []),
          item.url,
        ])
      : ["", "目前官網沒有辨識到新的機票優惠。"]),
    "",
    `查詢時間：${verifiedAt}`,
  ].join("\n");
}
