export const CHATGPT_PROMO_REPO_URL =
  "https://github.com/JUk1-GH/gpt-promo-scanner";
export const CHATGPT_PROMO_COMMITS_API_URL =
  "https://api.github.com/repos/JUk1-GH/gpt-promo-scanner/commits?path=known_codes.json&per_page=1";
export const OPENAI_PROMO_TERMS_URL =
  "https://help.openai.com/en/articles/10492689-chatgpt-plus-promotions-referrals";

function normalizeText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function assertChatgptPromoCommitsApiUrl(value) {
  const url = new URL(String(value ?? ""));
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "api.github.com" ||
    url.pathname.toLowerCase() !==
      "/repos/juk1-gh/gpt-promo-scanner/commits" ||
    url.searchParams.get("path") !== "known_codes.json" ||
    url.searchParams.get("per_page") !== "1"
  ) {
    throw new Error("ChatGPT 優惠情報 GitHub API 來源不符");
  }
  return url;
}

function assertCommitUrl(value, sha) {
  const url = new URL(String(value ?? ""));
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "github.com" ||
    url.pathname.toLowerCase() !==
      `/juk1-gh/gpt-promo-scanner/commit/${sha}`
  ) {
    throw new Error("ChatGPT 優惠情報 commit 連結來源不符");
  }
  return url;
}

export function parseChatgptPromoCommit(payload) {
  const row = Array.isArray(payload) ? payload[0] : null;
  const sha = normalizeText(row?.sha).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error("ChatGPT 優惠情報沒有可驗證的 commit");
  }
  const url = assertCommitUrl(row?.html_url, sha);
  const publishedAt = normalizeText(
    row?.commit?.committer?.date ||
      row?.commit?.author?.date,
  );
  if (Number.isNaN(Date.parse(publishedAt))) {
    throw new Error("ChatGPT 優惠情報 commit 時間無效");
  }
  const message = normalizeText(
    String(row?.commit?.message ?? "").split(/\r?\n/, 1)[0],
  ).slice(0, 240);
  const item = {
    sku: sha,
    name: "ChatGPT Business 公開優惠情報清單更新",
    description: message || "公開清單有新版本",
    publishedAt: new Date(publishedAt).toISOString(),
    url: url.href,
    sourceStatus: "社群情報，未經 OpenAI 官方驗證",
    fingerprint: sha,
  };
  return {
    totalProductCount: 1,
    macProductCount: 0,
    macMiniCount: 0,
    targetProducts: [item],
  };
}

function taipeiTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "時間格式錯誤";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date).replace(/\s+/g, " ");
}

function notification(item) {
  return {
    kind: "community_update",
    title: "🔎 ChatGPT Business 優惠情報更新",
    message: [
      `狀態：${item.sourceStatus}`,
      `更新：${item.description}`,
      `時間：${taipeiTime(item.publishedAt)}`,
      "",
      "系統只監看公開版本，不會猜碼、試碼、切換地區、登入或付款。",
      "僅在你符合活動指定對象與地區資格時使用。",
      `OpenAI 優惠條款：${OPENAI_PROMO_TERMS_URL}`,
    ].join("\n"),
    url: item.url,
    disablePreview: true,
  };
}

export function applyChatgptPromoUpdates(
  state,
  currentItems,
  nowIso,
) {
  const updated = clone(state);
  updated.products ??= {};
  const events = [];
  const current = new Set();

  for (const item of currentItems) {
    current.add(item.sku);
    const stored = updated.products[item.sku];
    if (!stored) {
      updated.products[item.sku] = {
        ...clone(item),
        present: true,
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
      };
      if (updated.initialized) events.push(notification(item));
      continue;
    }
    Object.assign(stored, clone(item), {
      present: true,
      lastSeenAt: nowIso,
    });
  }

  for (const [sku, stored] of Object.entries(updated.products)) {
    if (!current.has(sku)) stored.present = false;
  }
  updated.initialized = true;
  updated.consecutiveErrors = 0;
  updated.lastError = null;

  const entries = Object.entries(updated.products);
  if (entries.length > 100) {
    entries
      .sort(([, a], [, b]) =>
        String(b.lastSeenAt ?? "").localeCompare(
          String(a.lastSeenAt ?? ""),
        )
      )
      .slice(100)
      .forEach(([sku]) => delete updated.products[sku]);
  }
  return { state: updated, events };
}

export function buildChatgptPromoBaselineEvent(snapshot) {
  const item = snapshot.targetProducts[0];
  if (!item) return null;
  return {
    kind: "baseline",
    title: "✅ ChatGPT Business 優惠情報監控已啟用",
    message: [
      "已建立 GitHub 公開版本基準；之後只有新 commit 才通知。",
      "",
      `目前版本：${item.description}`,
      `更新時間：${taipeiTime(item.publishedAt)}`,
      `狀態：${item.sourceStatus}`,
      "",
      "不會執行掃描器、驗證碼、VPN、登入或付款功能。",
    ].join("\n"),
    url: item.url,
    disablePreview: true,
  };
}

export function formatChatgptPromoSummary(snapshot, checkedAt) {
  const item = snapshot.targetProducts[0];
  return [
    "🔎 ChatGPT Business 公開優惠情報",
    "",
    ...(item
      ? [
          `最新更新：${item.description}`,
          `發布時間：${taipeiTime(item.publishedAt)}`,
          `狀態：${item.sourceStatus}`,
          item.url,
        ]
      : ["目前沒有可驗證的公開版本更新。"]),
    "",
    "不自動猜碼、試碼、切換地區、登入或付款。",
    `OpenAI 優惠條款：${OPENAI_PROMO_TERMS_URL}`,
    `查詢時間：${checkedAt}`,
  ].join("\n");
}
