export const TIGERAIR_HOME_URL =
  "https://www.tigerairtw.com/zh-TW/index";
export const TIGERAIR_BANNERS_API_URL =
  "https://api-cms.tigerairtw.com/api/home-banners?language=zh-TW&perPage=100";

const OFFER_TERMS =
  /機票|票價|航線|購票|促銷|優惠|特惠|開賣|快閃|折扣|未稅/i;
const STRONG_FARE_TERMS =
  /機票|票價|航線|購票|促銷|特惠|開賣|快閃|未稅|全航線/i;
const EXCLUDED_TERMS =
  /飯店|公寓|藥妝|接送|行李特工|eSIM|wifi|免稅品/i;

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
  ].join("|");
}

function promotion({
  name,
  description = "",
  url,
  kind,
}) {
  const verifiedUrl = assertTigerairOfferUrl(url);
  const item = {
    sku: offerId(verifiedUrl),
    name: normalizeText(name).slice(0, 240),
    description: normalizeText(description).slice(0, 500),
    details: kind === "official-event"
      ? "台灣虎航官方促銷活動"
      : "台灣虎航官網優惠消息",
    url: verifiedUrl.href,
    kind,
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
    const isOfficialBookingOffer =
      host === "booking.tigerairtw.com" &&
      path.startsWith("/zh-tw/portal/");
    if (
      !row.text ||
      EXCLUDED_TERMS.test(row.text) ||
      !OFFER_TERMS.test(row.text) ||
      (!isOfficialNews && !isOfficialBookingOffer)
    ) {
      continue;
    }
    addPromotion(promotion({
      name: row.text,
      url: url.href,
      kind: isOfficialNews ? "official-news" : "official-offer",
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
  const evidence = `${title} ${description} ${normalizeText(html).slice(0, 3000)}`;
  if (
    !title ||
    EXCLUDED_TERMS.test(`${title} ${description}`) ||
    !STRONG_FARE_TERMS.test(evidence)
  ) {
    return null;
  }
  return promotion({
    name: title,
    description,
    url: url.href,
    kind: "official-event",
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
      ? "🔄 台灣虎航優惠更新"
      : "✈️ 台灣虎航最新優惠",
    message: [
      item.name,
      ...(item.description ? ["", item.description] : []),
    ].join("\n"),
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
    Object.assign(stored, clone(item), {
      present: true,
      lastSeenAt: nowIso,
    });
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
          item.url,
        ])
      : ["", "目前官網沒有辨識到新的機票優惠。"]),
    "",
    `查詢時間：${verifiedAt}`,
  ].join("\n");
}
