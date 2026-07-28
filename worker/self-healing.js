const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000;

function normalize(value) {
  return String(value ?? "").trim();
}

export function classifyMonitorError(error) {
  const message = normalize(error instanceof Error ? error.message : error);
  if (/\b(?:401|403)\b|access denied|拒絕|captcha|驗證碼/i.test(message)) {
    return "blocked";
  }
  if (/\b429\b|rate.?limit|too many requests/i.test(message)) {
    return "rate_limited";
  }
  if (/timeout|timed out|逾時|network|fetch failed|dns|連線/i.test(message)) {
    return "transient";
  }
  if (/沒有辨識|沒有可驗證|解析|結構|格式|json|商品卡片/i.test(message)) {
    return "parser_changed";
  }
  if (/價格|price|貨幣|currency|異常資料|不可信/i.test(message)) {
    return "invalid_data";
  }
  return "unknown";
}

export function shouldRetryMonitorError(error, attempt, maxAttempts) {
  if (attempt >= maxAttempts) return false;
  return new Set(["blocked", "rate_limited", "transient", "unknown"])
    .has(classifyMonitorError(error));
}

export async function runWithRetry(
  task,
  {
    maxAttempts = 2,
    onRetry = null,
  } = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (!shouldRetryMonitorError(error, attempt, maxAttempts)) {
        throw error;
      }
      onRetry?.(error, attempt + 1);
    }
  }
  throw lastError;
}

export function circuitStatus(
  state,
  now = new Date(),
  {
    threshold = 6,
    cooldownMs = DEFAULT_COOLDOWN_MS,
  } = {},
) {
  const errors = Number(state?.consecutiveErrors ?? 0);
  const lastRunMs = Date.parse(state?.lastRunAt ?? "");
  if (
    errors < threshold ||
    !Number.isFinite(lastRunMs)
  ) {
    return { open: false, retryAt: null };
  }
  const retryAtMs = lastRunMs + cooldownMs;
  if (now.getTime() >= retryAtMs) {
    return { open: false, retryAt: new Date(retryAtMs).toISOString() };
  }
  return {
    open: true,
    retryAt: new Date(retryAtMs).toISOString(),
  };
}

export function validateSnapshot(snapshot, {
  requireProducts = true,
  minimumPrice = 100,
  maximumPrice = 5_000_000,
} = {}) {
  if (!snapshot || !Array.isArray(snapshot.targetProducts)) {
    throw new Error("異常資料：缺少可驗證的商品清單");
  }
  const total = Number(snapshot.totalProductCount);
  if (requireProducts && (!Number.isFinite(total) || total < 1)) {
    throw new Error("異常資料：來源商品數突然歸零，拒絕覆蓋可信狀態");
  }
  const seen = new Set();
  for (const product of snapshot.targetProducts) {
    const sku = normalize(product?.sku);
    const price = Number(product?.priceTwd);
    let url;
    try {
      url = new URL(product?.url);
    } catch {
      throw new Error("異常資料：商品購買網址無效");
    }
    if (!sku || seen.has(sku)) {
      throw new Error("異常資料：商品識別碼缺失或重複");
    }
    if (
      !Number.isFinite(price) ||
      price < minimumPrice ||
      price > maximumPrice
    ) {
      throw new Error("異常資料：商品價格超出可信範圍");
    }
    if (url.protocol !== "https:") {
      throw new Error("異常資料：商品購買網址不是 HTTPS");
    }
    seen.add(sku);
  }
  return snapshot;
}

export const SELF_HEALING_DEFAULTS = {
  circuitThreshold: 6,
  cooldownMs: DEFAULT_COOLDOWN_MS,
  maxAttempts: 2,
};
