import {
  applyInventory,
  applyMonitorError,
  emptyMonitorState,
  recoveryEvent,
} from "./monitor-state.js";

const APPLE_REFURB_URL =
  "https://www.apple.com/tw/shop/refurbished/mac";
const TELEGRAM_API_BASE = "https://api.telegram.org";

const DEVICE_FAMILIES = [
  "Mac mini",
  "MacBook Pro",
  "MacBook Air",
  "MacBook Neo",
  "MacBook",
  "iMac",
  "Mac Studio",
  "Mac Pro",
  "其他 Mac",
];

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function visitProducts(value, products) {
  if (Array.isArray(value)) {
    for (const item of value) {
      visitProducts(item, products);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  if (value["@type"] === "Product") {
    products.push(value);
  }
  if (value["@graph"] !== undefined) {
    visitProducts(value["@graph"], products);
  }
}

function jsonLdProducts(html) {
  const products = [];
  const pattern =
    /<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const raw = match[1].trim();
    if (!raw) {
      continue;
    }
    try {
      visitProducts(JSON.parse(raw), products);
    } catch {
      // Ignore an unrelated malformed JSON-LD block.
    }
  }
  return products;
}

function deviceFamily(name) {
  const lowered = name.toLowerCase();
  if (lowered.includes("mac mini")) return "Mac mini";
  if (lowered.includes("macbook pro")) return "MacBook Pro";
  if (lowered.includes("macbook air")) return "MacBook Air";
  if (lowered.includes("macbook neo")) return "MacBook Neo";
  if (lowered.includes("mac studio")) return "Mac Studio";
  if (lowered.includes("mac pro")) return "Mac Pro";
  if (lowered.includes("imac")) return "iMac";
  if (lowered.includes("macbook")) return "MacBook";
  if (lowered.includes("mac")) return "其他 Mac";
  return null;
}

function storageGb(description) {
  const match = description.match(
    /(?<!\d)(\d+(?:\.\d+)?)\s*(GB|TB)\s*SSD/i,
  );
  if (!match) {
    return null;
  }
  const multiplier = match[2].toUpperCase() === "TB" ? 1024 : 1;
  return Math.trunc(Number(match[1]) * multiplier);
}

function firstOffer(product) {
  if (Array.isArray(product.offers)) {
    return product.offers.find(
      (offer) => offer && typeof offer === "object",
    ) ?? {};
  }
  return product.offers && typeof product.offers === "object"
    ? product.offers
    : {};
}

function targetProduct(product) {
  const name = normalizeText(product.name);
  const description = normalizeText(product.description);
  if (!name.toLowerCase().includes("mac mini")) {
    return null;
  }
  if (
    !/\bApple\s*M4\s*晶片/i.test(name) ||
    /\bM4\s*(?:Pro|Max)\b/i.test(name)
  ) {
    return null;
  }

  const storage = storageGb(description);
  if (![256, 512].includes(storage)) {
    return null;
  }

  const offer = firstOffer(product);
  const sku = normalizeText(offer.sku || product.sku).toUpperCase();
  const url = normalizeText(product.url || product.mainEntityOfPage);
  const price = Number(offer.price);
  if (!sku || !url || !Number.isFinite(price)) {
    return null;
  }

  const memoryMatch = description.match(
    /(?<!\d)(\d+)\s*GB\s*統一記憶體/i,
  );
  return {
    sku,
    name,
    storageGb: storage,
    memoryGb: memoryMatch ? Number(memoryMatch[1]) : null,
    priceTwd: Math.trunc(price),
    url,
  };
}

export function parseAppleInventory(html) {
  const products = jsonLdProducts(html);
  if (products.length === 0) {
    throw new Error("Apple 頁面沒有可用的 JSON-LD Product");
  }

  const counts = new Map();
  const targets = new Map();
  for (const product of products) {
    const family = deviceFamily(normalizeText(product.name));
    if (family) {
      counts.set(family, (counts.get(family) ?? 0) + 1);
    }
    const target = targetProduct(product);
    if (target) {
      targets.set(target.sku, target);
    }
  }
  if (counts.size === 0) {
    throw new Error("Apple 整修 Mac 頁面沒有辨識到任何 Mac 設備");
  }

  const deviceCounts = DEVICE_FAMILIES.flatMap((family) => {
    const count = counts.get(family) ?? 0;
    return count ? [[family, count]] : [];
  });
  return {
    totalProductCount: products.length,
    macProductCount: deviceCounts.reduce(
      (total, [, count]) => total + count,
      0,
    ),
    macMiniCount: counts.get("Mac mini") ?? 0,
    deviceCounts,
    targetProducts: [...targets.values()].sort((a, b) =>
      a.sku.localeCompare(b.sku),
    ),
  };
}

function taipeiTime(value = new Date()) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    dateStyle: "medium",
    timeStyle: "medium",
    hour12: false,
  }).format(value);
}

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function formatInventorySummary(snapshot) {
  const devices = snapshot.deviceCounts
    .map(([family, count]) => `${family} ${count} 項`)
    .join("、");
  return [
    "🔎 Apple 整修 Mac 即時查詢",
    "",
    `全部商品：${snapshot.totalProductCount} 項`,
    `Mac：${snapshot.macProductCount} 項`,
    `設備：${devices || "目前未找到 Mac"}`,
    `Mac mini：${snapshot.macMiniCount} 項`,
    `符合 M4 mini 256／512GB：${snapshot.targetProducts.length} 項`,
    `查詢時間：${taipeiTime()}`,
    "",
    `購買頁：${APPLE_REFURB_URL}`,
  ].join("\n");
}

export function formatPurchaseMessage(snapshot) {
  if (snapshot.targetProducts.length === 0) {
    return [
      "🛒 目前沒有符合條件的整修品",
      "",
      "條件：標準版 M4 Mac mini、256GB／512GB SSD，排除 M4 Pro。",
      `Apple 整修 Mac 購買頁：${APPLE_REFURB_URL}`,
    ].join("\n");
  }

  const products = snapshot.targetProducts.slice(0, 10).flatMap(
    (product, index) => {
      const memory = product.memoryGb
        ? `、${product.memoryGb}GB 記憶體`
        : "";
      return [
        `${index + 1}. ${product.name}`,
        `${product.storageGb}GB SSD${memory}｜NT$${product.priceTwd.toLocaleString("en-US")}`,
        product.url,
        "",
      ];
    },
  );
  if (snapshot.targetProducts.length > 10) {
    products.push(
      `另有 ${snapshot.targetProducts.length - 10} 項，請開啟購買頁查看。`,
      "",
    );
  }
  return [
    `🛒 找到 ${snapshot.targetProducts.length} 項符合條件的 Mac mini`,
    "",
    ...products,
    `Apple 整修 Mac 購買頁：${APPLE_REFURB_URL}`,
  ].join("\n");
}

function helpMessage() {
  return [
    "🤖 Mac mini 整修品監控指令",
    "",
    "/check－立即查詢 Apple 商品與設備數量",
    "/buy－列出符合條件的商品與購買連結",
    "/status－確認即時 Bot 與監控狀態",
    "/link－開啟 Apple 整修 Mac 購買頁",
    "/help－顯示這份說明",
  ].join("\n");
}

async function fetchInventory(fetchImpl) {
  const response = await fetchImpl(APPLE_REFURB_URL, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.7",
      "Cache-Control": "no-cache",
      "User-Agent":
        "Mozilla/5.0 AppleWebKit/537.36 mac-mini-refurb-monitor-worker/1.0",
    },
    cf: {
      cacheEverything: true,
      cacheTtl: 60,
    },
  });
  if (!response.ok) {
    throw new Error(`Apple HTTP ${response.status}`);
  }
  return parseAppleInventory(await response.text());
}

export async function replyForCommand(
  text,
  fetchImpl = fetch,
  statusProvider = null,
) {
  const rawCommand = normalizeText(text).split(/\s+/, 1)[0] || "";
  const command = rawCommand.split("@", 1)[0].toLowerCase();

  if (["/start", "/help"].includes(command)) {
    return helpMessage();
  }
  if (command === "/link") {
    return `Apple 台灣整修 Mac 購買頁：\n${APPLE_REFURB_URL}`;
  }
  if (command === "/status") {
    const snapshot = await fetchInventory(fetchImpl);
    const monitor = statusProvider ? await statusProvider() : null;
    const scheduleStatus = monitor?.lastSuccessAt
      ? [
          `Cloudflare 排程：正常`,
          `最近成功：${taipeiTime(new Date(monitor.lastSuccessAt))}`,
          `連續錯誤：${monitor.consecutiveErrors}`,
        ].join("\n")
      : "Cloudflare 排程：等待第一次執行";
    return [
      "✅ 即時 Bot 與 Apple 頁面均正常",
      "",
      formatInventorySummary(snapshot),
      "",
      scheduleStatus,
      "自動監控：Cloudflare 每 5 分鐘執行。",
    ].join("\n");
  }
  if (command === "/check") {
    return formatInventorySummary(await fetchInventory(fetchImpl));
  }
  if (command === "/buy") {
    return formatPurchaseMessage(await fetchInventory(fetchImpl));
  }
  return `不支援這個指令。\n\n${helpMessage()}`;
}

async function telegramRequest(env, method, payload, fetchImpl = fetch) {
  const response = await fetchImpl(
    `${TELEGRAM_API_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(payload),
    },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok !== true) {
    throw new Error(`Telegram ${method} 失敗（HTTP ${response.status}）`);
  }
  return result.result;
}

class NotificationError extends Error {}

async function sendMonitorEvents(env, events) {
  for (const event of events) {
    let text = `${event.title}\n\n${event.message}`;
    if (event.url) {
      text += `\n\n${event.url}`;
    }
    try {
      await telegramRequest(env, "sendMessage", {
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        link_preview_options: {
          is_disabled: false,
        },
      });
    } catch (error) {
      throw new NotificationError(
        error instanceof Error ? error.message : "Telegram 通知失敗",
      );
    }
  }
}

async function loadMonitorState(env) {
  const row = await env.MONITOR_DB.prepare(
    `SELECT
      version,
      initialized,
      products_json,
      consecutive_errors,
      last_heartbeat_date,
      last_run_at,
      last_success_at,
      last_error
    FROM monitor_state
    WHERE id = 1`,
  ).first();
  if (!row) {
    return emptyMonitorState();
  }
  return {
    version: Number(row.version),
    initialized: Boolean(row.initialized),
    products: JSON.parse(row.products_json),
    consecutiveErrors: Number(row.consecutive_errors),
    lastHeartbeatDate: row.last_heartbeat_date,
    lastRunAt: row.last_run_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
  };
}

async function persistMonitorResult(
  env,
  state,
  {
    status,
    snapshot = null,
    eventCount = 0,
    errorMessage = null,
  },
) {
  await env.MONITOR_DB.batch([
    env.MONITOR_DB.prepare(
      `INSERT INTO monitor_state (
        id,
        version,
        initialized,
        products_json,
        consecutive_errors,
        last_heartbeat_date,
        last_run_at,
        last_success_at,
        last_error
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        version = excluded.version,
        initialized = excluded.initialized,
        products_json = excluded.products_json,
        consecutive_errors = excluded.consecutive_errors,
        last_heartbeat_date = excluded.last_heartbeat_date,
        last_run_at = excluded.last_run_at,
        last_success_at = excluded.last_success_at,
        last_error = excluded.last_error`,
    ).bind(
      state.version,
      state.initialized ? 1 : 0,
      JSON.stringify(state.products),
      state.consecutiveErrors,
      state.lastHeartbeatDate,
      state.lastRunAt,
      state.lastSuccessAt,
      state.lastError,
    ),
    env.MONITOR_DB.prepare(
      `INSERT INTO monitor_runs (
        ran_at,
        status,
        total_product_count,
        mac_product_count,
        mac_mini_count,
        target_product_count,
        event_count,
        error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      state.lastRunAt,
      status,
      snapshot?.totalProductCount ?? null,
      snapshot?.macProductCount ?? null,
      snapshot?.macMiniCount ?? null,
      snapshot?.targetProducts.length ?? null,
      eventCount,
      errorMessage,
    ),
    env.MONITOR_DB.prepare(
      `DELETE FROM monitor_runs
      WHERE id NOT IN (
        SELECT id FROM monitor_runs ORDER BY id DESC LIMIT 2016
      )`,
    ),
  ]);
}

async function monitorStatus(env) {
  const state = await loadMonitorState(env);
  return {
    initialized: state.initialized,
    consecutiveErrors: state.consecutiveErrors,
    lastRunAt: state.lastRunAt,
    lastSuccessAt: state.lastSuccessAt,
    lastError: state.lastError,
  };
}

export async function runScheduledMonitor(env) {
  const original = await loadMonitorState(env);
  const previousErrorCount = original.consecutiveErrors;
  const nowIso = new Date().toISOString();

  try {
    const snapshot = await fetchInventory(fetch);
    const result = applyInventory(
      original,
      snapshot.targetProducts,
      nowIso,
    );
    const updated = result.state;
    const events = result.events;
    const recovered = recoveryEvent(previousErrorCount);
    if (recovered) {
      events.unshift(recovered);
    }

    const today = taipeiDate();
    if (
      original.initialized &&
      updated.lastHeartbeatDate !== today
    ) {
      events.push({
        kind: "heartbeat",
        title: "💚 Mac mini 監控正常",
        message: formatInventorySummary(snapshot),
        url: APPLE_REFURB_URL,
      });
      updated.lastHeartbeatDate = today;
    } else if (!original.initialized) {
      updated.lastHeartbeatDate = today;
    }

    await sendMonitorEvents(env, events);
    updated.lastRunAt = nowIso;
    updated.lastSuccessAt = nowIso;
    await persistMonitorResult(env, updated, {
      status: "success",
      snapshot,
      eventCount: events.length,
    });
    console.log(
      `監控成功：全部 ${snapshot.totalProductCount}，` +
      `Mac ${snapshot.macProductCount}，Mac mini ${snapshot.macMiniCount}，` +
      `符合條件 ${snapshot.targetProducts.length}，事件 ${events.length}`,
    );
    return {
      ok: true,
      snapshot,
      eventCount: events.length,
    };
  } catch (error) {
    if (error instanceof NotificationError) {
      throw error;
    }
    const message =
      error instanceof Error ? error.message : "未知監控錯誤";
    const result = applyMonitorError(original, message, nowIso);
    let notificationError = null;
    try {
      await sendMonitorEvents(env, result.events);
    } catch (sendError) {
      notificationError = sendError;
    }
    await persistMonitorResult(env, result.state, {
      status: "error",
      eventCount: result.events.length,
      errorMessage: message,
    });
    console.error(`監控失敗：${message}`);
    if (notificationError) {
      throw notificationError;
    }
    return {
      ok: false,
      error: message,
      eventCount: result.events.length,
    };
  }
}

async function handleTelegramUpdate(update, env) {
  const message = update?.message;
  if (!message?.text || message.chat?.id === undefined) {
    return;
  }
  if (String(message.chat.id) !== String(env.TELEGRAM_CHAT_ID)) {
    return;
  }

  let reply;
  try {
    reply = await replyForCommand(
      message.text,
      fetch,
      () => monitorStatus(env),
    );
  } catch (error) {
    reply = [
      "⚠️ 即時查詢暫時失敗",
      error instanceof Error ? error.message : "未知錯誤",
      "",
      `你仍可直接查看：${APPLE_REFURB_URL}`,
    ].join("\n");
  }
  await telegramRequest(env, "sendMessage", {
    chat_id: message.chat.id,
    text: reply,
    link_preview_options: {
      is_disabled: false,
    },
  });
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      let monitor = null;
      try {
        monitor = await monitorStatus(env);
      } catch (error) {
        monitor = {
          databaseError:
            error instanceof Error ? error.message : "unknown",
        };
      }
      return Response.json({
        ok: true,
        service: "mac-mini-refurb-monitor-bot",
        scheduler: "*/5 * * * *",
        monitor,
      });
    }
    if (request.method !== "POST" || url.pathname !== "/telegram") {
      return new Response("Not found", { status: 404 });
    }
    if (
      request.headers.get("X-Telegram-Bot-Api-Secret-Token") !==
      env.TELEGRAM_WEBHOOK_SECRET
    ) {
      return new Response("Unauthorized", { status: 401 });
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    context.waitUntil(handleTelegramUpdate(update, env));
    return new Response("OK");
  },

  async scheduled(_controller, env, context) {
    context.waitUntil(runScheduledMonitor(env));
  },
};

export { APPLE_REFURB_URL };
