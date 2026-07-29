export const CHATGPT_PROMO_REPO_URL =
  "https://github.com/JUk1-GH/gpt-promo-scanner";
export const CHATGPT_PROMO_CATALOG_URL =
  "https://raw.githubusercontent.com/JUk1-GH/gpt-promo-scanner/main/known_codes.json";
export const OPENAI_PROMO_TERMS_URL =
  "https://help.openai.com/en/articles/10492689-chatgpt-plus-promotions-referrals";

const MAX_CATALOG_ENTRIES = 500;
const MAX_NOTIFICATION_CHANGES = 12;
const MAX_SUMMARY_LENGTH = 3_700;
export const CHATGPT_PROMO_DEFAULT_RECENT_HOURS = 24 * 7;

function normalizeText(value, maxLength = 160) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function parseChatgptPromoQuery(value) {
  const tokens = normalizeText(value, 200)
    .split(/\s+/)
    .slice(1);
  let region = "";
  let includeAll = false;
  let maxAgeHours = CHATGPT_PROMO_DEFAULT_RECENT_HOURS;

  for (const rawToken of tokens) {
    const token = rawToken.toLowerCase();
    if (["all", "全部", "完整"].includes(token)) {
      includeAll = true;
      continue;
    }
    if (/^[a-z]{2}$/.test(token) && !region) {
      region = token.toUpperCase();
      continue;
    }
    const duration = token.match(/^(\d{1,3})(h|d|小時|天)$/);
    if (duration) {
      const amount = Number(duration[1]);
      const unit = duration[2];
      const hours = ["d", "天"].includes(unit) ? amount * 24 : amount;
      if (hours < 1 || hours > 24 * 30) {
        throw new Error("查詢期間必須介於 1 小時至 30 天");
      }
      maxAgeHours = hours;
      includeAll = false;
      continue;
    }
    throw new Error(
      "格式：/gptpromo [地區碼] [7d]；完整清單請用 /gptpromo all",
    );
  }
  return { region, includeAll, maxAgeHours };
}

export function assertChatgptPromoCatalogUrl(value) {
  const url = new URL(String(value ?? ""));
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "raw.githubusercontent.com" ||
    url.pathname.toLowerCase() !==
      "/juk1-gh/gpt-promo-scanner/main/known_codes.json" ||
    url.search
  ) {
    throw new Error("ChatGPT 優惠清單來源不符");
  }
  return url;
}

function normalizedNumber(value, { min = 0, max = 1_000_000 } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error("ChatGPT 優惠清單包含無效數值");
  }
  return number;
}

function catalogItem(entry, region, status) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error("ChatGPT 優惠清單項目格式錯誤");
  }
  const code = normalizeText(entry.code, 80).toLowerCase();
  const company = normalizeText(entry.company, 100);
  const normalizedRegion = normalizeText(region, 8).toUpperCase();
  if (
    !/^[a-z0-9_-]{2,80}$/.test(code) ||
    !company ||
    !/^[A-Z]{2}$/.test(normalizedRegion)
  ) {
    throw new Error("ChatGPT 優惠清單缺少代碼、公司或地區");
  }
  const priceLocal = normalizeText(entry.price_local, 80) || null;
  const priceUsd = normalizedNumber(entry.price_usd);
  const discountPct = normalizedNumber(entry.discount_pct, {
    min: 0,
    max: 100,
  });
  const durationMonths = normalizedNumber(entry.duration_months, {
    min: 1,
    max: 120,
  });
  const note = normalizeText(entry.note, 180) || null;
  const item = {
    sku: `${normalizedRegion}:${code}`,
    code,
    name: company,
    company,
    region: normalizedRegion,
    status,
    priceLocal,
    priceUsd,
    discountPct,
    durationMonths,
    note,
    url: `${CHATGPT_PROMO_REPO_URL}/blob/main/known_codes.json`,
    sourceStatus: "社群公開清單，未經 OpenAI 官方驗證",
  };
  item.fingerprint = JSON.stringify([
    item.status,
    item.priceLocal,
    item.priceUsd,
    item.discountPct,
    item.durationMonths,
    item.note,
  ]);
  return item;
}

export function parseChatgptPromoCatalog(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("ChatGPT 優惠清單 JSON 格式錯誤");
  }
  const lastUpdated = normalizeText(payload.last_updated, 20);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(lastUpdated) ||
    Number.isNaN(Date.parse(`${lastUpdated}T00:00:00Z`))
  ) {
    throw new Error("ChatGPT 優惠清單更新日期無效");
  }
  if (
    !payload.valid ||
    typeof payload.valid !== "object" ||
    Array.isArray(payload.valid) ||
    !Array.isArray(payload.expired)
  ) {
    throw new Error("ChatGPT 優惠清單缺少 valid 或 expired");
  }

  const items = [];
  for (const [region, entries] of Object.entries(payload.valid)) {
    if (!Array.isArray(entries)) {
      throw new Error("ChatGPT 優惠清單地區內容格式錯誤");
    }
    for (const entry of entries) {
      items.push(catalogItem(entry, region, "valid"));
    }
  }
  for (const entry of payload.expired) {
    items.push(catalogItem(entry, entry?.region, "expired"));
  }
  if (items.length === 0 || items.length > MAX_CATALOG_ENTRIES) {
    throw new Error("ChatGPT 優惠清單項目數量異常");
  }
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.sku)) {
      throw new Error(`ChatGPT 優惠清單出現重複項目：${item.sku}`);
    }
    seen.add(item.sku);
  }
  items.sort((a, b) =>
    a.region.localeCompare(b.region) ||
    a.code.localeCompare(b.code)
  );
  const validItems = items.filter((item) => item.status === "valid");
  const expiredItems = items.filter((item) => item.status === "expired");
  return {
    totalProductCount: items.length,
    macProductCount: 0,
    macMiniCount: 0,
    targetProducts: items,
    lastUpdated,
    validCount: validItems.length,
    expiredCount: expiredItems.length,
    regionCount: new Set(validItems.map((item) => item.region)).size,
  };
}

function displayPrice(item) {
  if (item.priceLocal) return item.priceLocal;
  if (item.priceUsd !== null) return `US$${item.priceUsd}/月`;
  return "價格待確認";
}

function displayItem(item, { includeStatus = false } = {}) {
  const details = [
    item.region,
    item.code,
    item.company,
    displayPrice(item),
  ];
  if (item.discountPct !== null) details.push(`折扣 ${item.discountPct}%`);
  if (includeStatus && item.status === "expired") details.push("已列為失效");
  return details.join("｜");
}

function catalogUpdateEvent(changes, snapshot) {
  const visible = changes.slice(0, MAX_NOTIFICATION_CHANGES);
  const remaining = changes.length - visible.length;
  return {
    kind: "catalog_update",
    title: "🔎 ChatGPT Business 公開優惠清單更新",
    message: [
      `清單日期：${snapshot.lastUpdated}`,
      `狀態：社群公開清單，未經 OpenAI 官方驗證`,
      "",
      ...visible,
      ...(remaining > 0 ? [`…另有 ${remaining} 項變更`] : []),
      "",
      "系統不會猜碼、試碼、切換地區、登入或付款。",
      "使用前請自行確認符合活動資格與地區限制。",
      `OpenAI 優惠條款：${OPENAI_PROMO_TERMS_URL}`,
    ].join("\n"),
    url: CHATGPT_PROMO_CATALOG_URL,
    disablePreview: true,
  };
}

export function applyChatgptPromoUpdates(state, snapshot, nowIso) {
  const updated = clone(state);
  updated.products ??= {};
  const current = new Map(
    snapshot.targetProducts.map((item) => [item.sku, clone(item)]),
  );
  const changes = [];

  if (!updated.initialized) {
    for (const [sku, item] of current) {
      updated.products[sku] = {
        ...item,
        present: true,
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        recentEligible: false,
      };
    }
    updated.initialized = true;
    updated.consecutiveErrors = 0;
    updated.lastError = null;
    return { state: updated, events: [] };
  }

  for (const [sku, observed] of current) {
    const stored = updated.products[sku];
    if (!stored) {
      updated.products[sku] = {
        ...observed,
        present: true,
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        recentEligible: true,
      };
      changes.push(
        observed.status === "expired"
          ? `失效紀錄新增：${displayItem(observed)}`
          : `新增：${displayItem(observed)}`,
      );
      continue;
    }
    const wasPresent = Boolean(stored.present);
    const previousStatus = stored.status;
    const previousFingerprint = stored.fingerprint;
    Object.assign(stored, clone(observed), {
      present: true,
      lastSeenAt: nowIso,
    });
    if (!wasPresent) {
      changes.push(`重新出現：${displayItem(observed, { includeStatus: true })}`);
    } else if (previousStatus !== observed.status) {
      changes.push(
        observed.status === "expired"
          ? `已列為失效：${displayItem(observed)}`
          : `恢復有效清單：${displayItem(observed)}`,
      );
    } else if (previousFingerprint !== observed.fingerprint) {
      changes.push(`資料變更：${displayItem(observed, { includeStatus: true })}`);
    }
  }

  for (const [sku, stored] of Object.entries(updated.products)) {
    if (current.has(sku) || !stored.present) continue;
    stored.present = false;
    stored.lastSeenAt = nowIso;
    changes.push(`清單移除：${displayItem(stored, { includeStatus: true })}`);
  }
  updated.consecutiveErrors = 0;
  updated.lastError = null;
  return {
    state: updated,
    events: changes.length ? [catalogUpdateEvent(changes, snapshot)] : [],
  };
}

export function buildChatgptPromoBaselineEvent(snapshot) {
  return {
    kind: "baseline",
    title: "✅ ChatGPT Business 公開優惠清單監控已啟用",
    message: [
      `清單日期：${snapshot.lastUpdated}`,
      `公開有效項目：${snapshot.validCount} 項`,
      `地區：${snapshot.regionCount} 個`,
      `失效紀錄：${snapshot.expiredCount} 項`,
      "",
      "已把公開清單建立為 D1 比對基準；新增、失效、移除或資料變更才通知。",
      "所有項目均屬社群資料，未經 OpenAI 官方驗證。",
    ].join("\n"),
    url: CHATGPT_PROMO_CATALOG_URL,
    disablePreview: true,
  };
}

export function formatChatgptPromoSummary(
  snapshot,
  checkedAt,
  requestedRegion = "",
  {
    products = {},
    includeAll = true,
    maxAgeHours = CHATGPT_PROMO_DEFAULT_RECENT_HOURS,
    nowIso = new Date().toISOString(),
  } = {},
) {
  const region = normalizeText(requestedRegion, 8).toUpperCase();
  const nowMs = Date.parse(nowIso);
  const isRecent = (item) => {
    if (includeAll) return true;
    const stored = products[item.sku];
    if (!stored) return true;
    if (stored.recentEligible !== true) return false;
    const firstSeenMs = Date.parse(stored.firstSeenAt);
    if (!Number.isFinite(nowMs) || !Number.isFinite(firstSeenMs)) return false;
    const ageMs = nowMs - firstSeenMs;
    return ageMs >= 0 && ageMs <= maxAgeHours * 60 * 60 * 1_000;
  };
  const validItems = snapshot.targetProducts.filter(
    (item) =>
      item.status === "valid" &&
      (!region || item.region === region) &&
      isRecent(item),
  );
  const expiredItems = snapshot.targetProducts.filter(
    (item) =>
      item.status === "expired" &&
      (!region || item.region === region) &&
      isRecent(item),
  );
  const periodLabel = maxAgeHours % 24 === 0
    ? `${maxAgeHours / 24} 天`
    : `${maxAgeHours} 小時`;
  const lines = [
    "🔎 ChatGPT Business 公開優惠清單",
    "",
    `清單日期：${snapshot.lastUpdated}`,
    `地區：${region || "全部地區"}`,
    `時間範圍：${includeAll ? "完整公開清單" : `最近 ${periodLabel}新發現`}`,
    `公開有效：${validItems.length} 項`,
    "狀態：社群公開清單，未經 OpenAI 官方驗證",
    "",
  ];
  let currentRegion = "";
  for (const item of validItems) {
    if (item.region !== currentRegion) {
      currentRegion = item.region;
      lines.push(`【${currentRegion}】`);
    }
    lines.push(`• ${displayItem(item)}`);
  }
  if (expiredItems.length) {
    lines.push("", `失效紀錄：${expiredItems.length} 項`);
    for (const item of expiredItems) {
      lines.push(`• ${displayItem(item, { includeStatus: true })}`);
    }
  }
  if (!validItems.length && !expiredItems.length) {
    lines.push(
      includeAll
        ? "這個地區目前沒有公開項目。"
        : `最近 ${periodLabel}沒有新發現的公開項目。`,
    );
  }
  lines.push(
    "",
    "不代表目前帳號符合資格；不會自動試碼、跨區、登入或付款。",
    `OpenAI 優惠條款：${OPENAI_PROMO_TERMS_URL}`,
    `查詢時間：${checkedAt}`,
  );

  const output = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > MAX_SUMMARY_LENGTH) {
      output.push("…內容過長，請用 /gptpromo US 等地區碼縮小範圍。");
      break;
    }
    output.push(line);
    length += line.length + 1;
  }
  return output.join("\n");
}
