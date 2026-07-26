import {
  applyInventory,
  applyMonitorError,
  emptyMonitorState,
  recoveryEvent,
} from "./monitor-state.js";

const APPLE_REFURB_URL =
  "https://www.apple.com/tw/shop/refurbished/mac";
const COSTCO_DESKTOP_URL =
  "https://www.costco.com.tw/Digital-Mobile/Laptops-Computers/Desktops-Computers/c/20101";
const COSTCO_ORIGIN = "https://www.costco.com.tw";
const PCHOME_SEARCH_URL =
  "https://24h.pchome.com.tw/search/?q=mac%20mini%20m4";
const PCHOME_ORIGIN = "https://24h.pchome.com.tw";
const COUPANG_SEARCH_URL =
  "https://www.tw.coupang.com/srp/mac-mini?q=mac%20mini%20m4";
const COUPANG_ORIGIN = "https://www.tw.coupang.com";
const COUPANG_SONY_SEARCH_URL =
  "https://www.tw.coupang.com/srp/wh-1000xm6?q=WH-1000XM6";
const MAC_MONITOR_CRON = "*/5 * * * *";
const SONY_MONITOR_CRON =
  "2,7,12,17,22,27,32,37,42,47,52,57 * * * *";
const TELEGRAM_API_BASE = "https://api.telegram.org";
const SOURCE_TABLES = {
  apple: {
    state: "monitor_state",
    runs: "monitor_runs",
  },
  costco: {
    state: "costco_monitor_state",
    runs: "costco_monitor_runs",
  },
  pchome: {
    state: "pchome_monitor_state",
    runs: "pchome_monitor_runs",
  },
  coupang: {
    state: "coupang_monitor_state",
    runs: "coupang_monitor_runs",
  },
  sony: {
    state: "sony_monitor_state",
    runs: "sony_monitor_runs",
  },
};

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

function decodeHtml(value) {
  return normalizeText(
    String(value ?? "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">"),
  );
}

function costcoTargetProduct({
  name,
  url,
  priceTwd,
  sku,
  available,
}) {
  const lowered = name.toLowerCase();
  if (!lowered.includes("mac mini") || !available) {
    return null;
  }
  if (
    !/\bM4\s*(?:晶片|chip)/i.test(name) ||
    /\bM4\s*(?:Pro|Max)\b/i.test(name)
  ) {
    return null;
  }

  const storage = storageGb(name);
  if (![256, 512].includes(storage)) {
    return null;
  }
  const gbValues = [
    ...name.matchAll(/(?<!\d)(\d+)\s*GB\b/gi),
  ].map((match) => Number(match[1]));
  const memory = gbValues.find((value) => value !== storage) ?? null;
  return {
    sku: `COSTCO-${sku}`,
    name,
    storageGb: storage,
    memoryGb: memory,
    priceTwd,
    url,
  };
}

export function parseCostcoInventory(html) {
  const cards = [
    ...html.matchAll(
      /<sip-product-list-item\b[\s\S]*?<\/sip-product-list-item>/gi,
    ),
  ].map((match) => match[0]);
  if (cards.length === 0) {
    throw new Error("Costco 分類頁沒有辨識到任何商品卡片");
  }

  const products = [];
  for (const card of cards) {
    const link = card.match(
      /<a\b[^>]*\bclass=["'][^"']*\bthumb\b[^"']*["'][^>]*\btitle=["']([^"']+)["'][^>]*\bhref=["']([^"']+)["']/i,
    );
    const fallbackLink = card.match(
      /<a\b[^>]*\bclass=["'][^"']*\bthumb\b[^"']*["'][^>]*\bhref=["']([^"']+)["'][^>]*\btitle=["']([^"']+)["']/i,
    );
    const name = link
      ? decodeHtml(link[1])
      : decodeHtml(fallbackLink?.[2]);
    const path = link ? link[2] : fallbackLink?.[1];
    const skuMatch = String(path ?? "").match(/\/p\/(\d+)(?:[/?#]|$)/i);
    const priceMatch = card.match(
      /\bclass=["'][^"']*\bproduct-price-amount\b[^"']*["'][\s\S]*?\$\s*([\d,]+)/i,
    );
    if (!name || !path || !skuMatch || !priceMatch) {
      continue;
    }
    products.push({
      sku: skuMatch[1],
      name,
      url: new URL(decodeHtml(path), COSTCO_ORIGIN).href,
      priceTwd: Number(priceMatch[1].replaceAll(",", "")),
      available:
        /\badd-to-cart__btn\b/i.test(card) &&
        /加入購物車/.test(card),
    });
  }
  if (products.length === 0) {
    throw new Error("Costco 商品卡片缺少名稱、價格或商品編號");
  }

  const targets = new Map();
  for (const product of products) {
    const target = costcoTargetProduct(product);
    if (target) {
      targets.set(target.sku, target);
    }
  }
  const macProducts = products.filter((product) =>
    product.name.toLowerCase().includes("mac"),
  );
  const macMinis = products.filter((product) =>
    product.name.toLowerCase().includes("mac mini"),
  );
  return {
    totalProductCount: products.length,
    macProductCount: macProducts.length,
    macMiniCount: macMinis.length,
    deviceCounts: macMinis.length
      ? [["Mac mini", macMinis.length]]
      : [],
    targetProducts: [...targets.values()].sort((a, b) =>
      a.sku.localeCompare(b.sku),
    ),
  };
}

export function parsePchomeInventory(html) {
  const starts = [
    ...html.matchAll(
      /<div\b[^>]*\bclass=["'][^"']*\bc-prodInfoV2\b[^"']*\bc-prodInfoV2--gridCard\b[^"']*["'][^>]*>/gi,
    ),
  ];
  if (starts.length === 0) {
    throw new Error("PChome 搜尋頁沒有辨識到任何商品卡片");
  }

  const products = [];
  for (let index = 0; index < starts.length; index += 1) {
    const card = html.slice(
      starts[index].index,
      starts[index + 1]?.index ?? html.length,
    );
    const nameMatch = card.match(
      /<h3\b[^>]*\btitle=["']([^"']+)["'][^>]*\bdata-regression=["']store_prodName["']/i,
    );
    const linkMatch = card.match(
      /<a\b[^>]*\bclass=["'][^"']*\bc-prodInfoV2__link\b[^"']*["'][^>]*\bhref=["']([^"']+)["']/i,
    );
    const priceMatch = card.match(
      /\bc-prodInfoV2__priceValue--m\b[^>]*>\s*\$\s*([\d,]+)/i,
    );
    const cartMatch = card.match(
      /<button\b([^>]*)\bdata-regression=["']store_addToCart["'][^>]*>/i,
    );
    const name = decodeHtml(nameMatch?.[1]);
    const path = decodeHtml(linkMatch?.[1]);
    const skuMatch = path.match(/\/prod\/([A-Z0-9-]+)(?:[/?#]|$)/i);
    if (!name || !path || !skuMatch || !priceMatch) {
      continue;
    }
    products.push({
      sku: skuMatch[1].toUpperCase(),
      name,
      url: new URL(path, PCHOME_ORIGIN).href,
      priceTwd: Number(priceMatch[1].replaceAll(",", "")),
      available:
        Boolean(cartMatch) &&
        !/\bdisabled\b/i.test(cartMatch[0]) &&
        !/\bis-disabled\b/i.test(cartMatch[0]),
    });
  }
  if (products.length === 0) {
    throw new Error("PChome 商品卡片缺少名稱、價格或商品編號");
  }

  const targets = new Map();
  for (const product of products) {
    const target = costcoTargetProduct(product);
    if (target) {
      target.sku = `PCHOME-${product.sku}`;
      targets.set(target.sku, target);
    }
  }
  const macProducts = products.filter((product) =>
    product.name.toLowerCase().includes("mac"),
  );
  const macMinis = products.filter((product) =>
    product.name.toLowerCase().includes("mac mini"),
  );
  return {
    totalProductCount: products.length,
    macProductCount: macProducts.length,
    macMiniCount: macMinis.length,
    deviceCounts: macMinis.length
      ? [["Mac mini", macMinis.length]]
      : [],
    targetProducts: [...targets.values()].sort((a, b) =>
      a.sku.localeCompare(b.sku),
    ),
  };
}

function coupangTargetProduct(product) {
  if (
    !/\bapple\s+mac\s+mini\b/i.test(product.name) ||
    !/\bM4\b/i.test(product.name) ||
    /\bM4\s*(?:Pro|Max)\b/i.test(product.name) ||
    !product.available ||
    !Number.isFinite(product.priceTwd)
  ) {
    return null;
  }

  const gbValues = [
    ...product.name.matchAll(/(?<!\d)(\d+)\s*GB\b/gi),
  ].map((match) => Number(match[1]));
  const storage = gbValues.find((value) => [256, 512].includes(value));
  if (!storage) {
    return null;
  }
  const memory = gbValues.find((value) => value !== storage) ?? null;
  return {
    sku: `COUPANG-${product.sku}`,
    name: product.name,
    storageGb: storage,
    memoryGb: memory,
    priceTwd: product.priceTwd,
    url: product.url,
  };
}

function parseCoupangCards(html) {
  const starts = [
    ...html.matchAll(
      /<li\b[^>]*\bclass=["'][^"']*\bProductUnit_productUnit__[^"']*["'][^>]*>/gi,
    ),
  ];
  if (starts.length === 0) {
    throw new Error("酷澎搜尋頁沒有辨識到任何商品卡片");
  }

  const products = [];
  for (let index = 0; index < starts.length; index += 1) {
    const card = html.slice(
      starts[index].index,
      starts[index + 1]?.index ?? html.length,
    );
    const skuMatch = starts[index][0].match(
      /\bdata-id=["'](\d+)["']/i,
    );
    const linkMatch = card.match(
      /<a\b[^>]*\bhref=["']([^"']+)["']/i,
    );
    const nameMatch = card.match(
      /<div\b[^>]*\bclass=["'][^"']*\bProductUnit_productName[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    );
    const priceMatch = card.match(
      /<span\b[^>]*\btranslate=["']no["'][^>]*>\s*\$\s*([\d,]+)\s*<\/span>/i,
    );
    const name = decodeHtml(
      String(nameMatch?.[1] ?? "").replace(/<[^>]*>/g, ""),
    );
    const path = decodeHtml(linkMatch?.[1]);
    if (!skuMatch || !name || !path) {
      continue;
    }
    const priceTwd = priceMatch
      ? Number(priceMatch[1].replaceAll(",", ""))
      : null;
    const itemId = path.match(/[?&]itemId=(\d+)/i)?.[1] ?? null;
    products.push({
      sku: skuMatch[1],
      itemId,
      name,
      url: new URL(path, COUPANG_ORIGIN).href,
      priceTwd,
      available:
        Number.isFinite(priceTwd) &&
        !/(?:暫時缺貨|已售完|售罄|sold[\s_-]*out)/i.test(card),
    });
  }
  if (products.length === 0) {
    throw new Error("酷澎商品卡片缺少名稱、連結或商品編號");
  }
  return products;
}

export function parseCoupangInventory(html) {
  const products = parseCoupangCards(html);
  const targets = new Map();
  for (const product of products) {
    const target = coupangTargetProduct(product);
    if (target) {
      targets.set(target.sku, target);
    }
  }
  const macProducts = products.filter((product) =>
    /\bApple\s+Mac\b/i.test(product.name),
  );
  const macMinis = products.filter((product) =>
    /\bApple\s+Mac\s+mini\b/i.test(product.name),
  );
  return {
    totalProductCount: products.length,
    macProductCount: macProducts.length,
    macMiniCount: macMinis.length,
    deviceCounts: macMinis.length
      ? [["Mac mini", macMinis.length]]
      : [],
    targetProducts: [...targets.values()].sort((a, b) =>
      a.sku.localeCompare(b.sku),
    ),
  };
}

export function parseCoupangSonyInventory(html) {
  const products = parseCoupangCards(html);
  const targets = new Map();
  for (const product of products) {
    if (
      !/SONY\s+索尼/i.test(product.name) ||
      !/\bWH-1000XM6\b/i.test(product.name) ||
      !/銀色/.test(product.name) ||
      !/原廠保固\s*12\s*個月/i.test(product.name) ||
      !product.itemId ||
      !product.available ||
      !Number.isFinite(product.priceTwd)
    ) {
      continue;
    }
    const target = {
      sku: `SONY-${product.itemId}`,
      name: product.name,
      details: "銀色｜WH-1000XM6｜原廠保固 12 個月",
      priceTwd: product.priceTwd,
      url: product.url,
    };
    targets.set(target.sku, target);
  }
  return {
    totalProductCount: products.length,
    macProductCount: 0,
    macMiniCount: 0,
    deviceCounts: [],
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

export function formatInventorySummary(
  snapshot,
  { includePurchaseLink = true } = {},
) {
  const devices = snapshot.deviceCounts.map(
    ([family, count]) => `• ${family}：${count} 項`,
  );
  const lines = [
    "🔎 M4 Mac mini 即時查詢",
    "",
    "🎯 監控結果",
    `符合條件：${snapshot.targetProducts.length} 項`,
    `Mac mini 總數：${snapshot.macMiniCount} 項`,
    "",
    "⚙️ 監控條件",
    "標準版 M4｜256／512GB SSD｜排除 M4 Pro／Max",
    "",
    "📊 頁面概況",
    `Mac 商品：${snapshot.macProductCount} 項（全部商品 ${snapshot.totalProductCount} 項）`,
    ...(devices.length ? devices : ["• 目前未找到 Mac"]),
    `查詢時間：${taipeiTime()}`,
  ];
  if (includePurchaseLink) {
    lines.push("", `🛒 購買頁：${APPLE_REFURB_URL}`);
  }
  return lines.join("\n");
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

export function formatCostcoSummary(
  snapshot,
  { includePurchaseLink = true } = {},
) {
  const productLines = snapshot.targetProducts.length
    ? snapshot.targetProducts.flatMap((product, index) => [
        `${index + 1}. ${product.storageGb}GB｜NT$${product.priceTwd.toLocaleString("en-US")}｜有貨`,
        product.url,
      ])
    : ["目前沒有符合條件且可加入購物車的商品。"];
  const lines = [
    "🔎 Costco 台灣 M4 Mac mini 即時查詢",
    "",
    "🎯 監控結果",
    `符合條件且有貨：${snapshot.targetProducts.length} 項`,
    `分類頁 Mac mini：${snapshot.macMiniCount} 項`,
    "",
    "⚙️ 監控條件",
    "標準版 M4｜256／512GB SSD｜排除 M4 Pro／Max",
    "",
    ...productLines,
    "",
    `查詢時間：${taipeiTime()}`,
  ];
  if (includePurchaseLink) {
    lines.push("", `🛒 Costco 桌上型電腦頁：${COSTCO_DESKTOP_URL}`);
  }
  return lines.join("\n");
}

export function formatPchomeSummary(
  snapshot,
  { includePurchaseLink = true } = {},
) {
  const productLines = snapshot.targetProducts.length
    ? snapshot.targetProducts.flatMap((product, index) => [
        `${index + 1}. ${product.storageGb}GB｜NT$${product.priceTwd.toLocaleString("en-US")}｜有貨`,
        product.url,
      ])
    : ["目前沒有符合條件且可加入購物車的商品。"];
  const lines = [
    "🔎 PChome 24h M4 Mac mini 即時查詢",
    "",
    "🎯 監控結果",
    `符合條件且有貨：${snapshot.targetProducts.length} 項`,
    `搜尋頁 Mac mini：${snapshot.macMiniCount} 項`,
    "",
    "⚙️ 監控條件",
    "標準版 M4｜256／512GB SSD｜排除 M4 Pro／Max",
    "",
    ...productLines,
    "",
    `查詢時間：${taipeiTime()}`,
  ];
  if (includePurchaseLink) {
    lines.push("", `🛒 PChome 搜尋頁：${PCHOME_SEARCH_URL}`);
  }
  return lines.join("\n");
}

export function formatCoupangSummary(
  snapshot,
  { includePurchaseLink = true } = {},
) {
  const productLines = snapshot.targetProducts.length
    ? snapshot.targetProducts.flatMap((product, index) => [
        `${index + 1}. ${product.storageGb}GB｜NT$${product.priceTwd.toLocaleString("en-US")}｜有貨`,
        product.url,
      ])
    : ["目前沒有符合條件且有貨的商品。"];
  const lines = [
    "🔎 酷澎 M4 Mac mini 即時查詢",
    "",
    "🎯 監控結果",
    `符合條件且有貨：${snapshot.targetProducts.length} 項`,
    `搜尋頁 Apple Mac mini：${snapshot.macMiniCount} 項`,
    "",
    "⚙️ 監控條件",
    "標準版 M4｜256／512GB｜排除 M4 Pro／Max",
    "",
    ...productLines,
    "",
    `查詢時間：${taipeiTime()}`,
  ];
  if (includePurchaseLink) {
    lines.push("", `🛒 酷澎搜尋頁：${COUPANG_SEARCH_URL}`);
  }
  return lines.join("\n");
}

export function formatCoupangSonySummary(
  snapshot,
  { includePurchaseLink = true } = {},
) {
  const productLines = snapshot.targetProducts.length
    ? snapshot.targetProducts.flatMap((product, index) => [
        `${index + 1}. 銀色 WH-1000XM6｜NT$${product.priceTwd.toLocaleString("en-US")}｜有貨`,
        product.url,
      ])
    : ["目前沒有找到指定的銀色 WH-1000XM6 有貨商品。"];
  const lines = [
    "🎧 酷澎 Sony WH-1000XM6 降價追蹤",
    "",
    "🎯 追蹤結果",
    `指定商品：${snapshot.targetProducts.length} 項`,
    "",
    "⚙️ 精確條件",
    "SONY｜WH-1000XM6｜銀色｜原廠保固 12 個月",
    "比較公開未登入售價，不含個人首購、會員或信用卡優惠。",
    "價格不變不重複通知，只在價格降低時推播。",
    "",
    ...productLines,
    "",
    `查詢時間：${taipeiTime()}`,
  ];
  if (includePurchaseLink) {
    lines.push("", `🛒 酷澎搜尋頁：${COUPANG_SONY_SEARCH_URL}`);
  }
  return lines.join("\n");
}

function helpMessage() {
  return [
    "🤖 M4 Mac mini 監控指令",
    "",
    "/check－立即查詢 Apple 商品與設備數量",
    "/costco－立即查詢 Costco 台灣庫存與價格",
    "/pchome－立即查詢 PChome 24h 庫存與價格",
    "/coupang－立即查詢酷澎庫存、價格與購買連結",
    "/sony－立即查詢酷澎銀色 Sony WH-1000XM6 價格",
    "/buy－列出符合條件的商品與購買連結",
    "/status－確認所有商品與購物站的排程狀態",
    "/test－傳送一則 Cloudflare 主動通知測試",
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

async function fetchCostcoInventory(fetchImpl) {
  const response = await fetchImpl(COSTCO_DESKTOP_URL, {
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
    throw new Error(`Costco HTTP ${response.status}`);
  }
  return parseCostcoInventory(await response.text());
}

async function fetchPchomeInventory(fetchImpl) {
  const response = await fetchImpl(PCHOME_SEARCH_URL, {
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
    throw new Error(`PChome HTTP ${response.status}`);
  }
  return parsePchomeInventory(await response.text());
}

async function fetchCoupangPage(browser, url, label) {
  if (!browser?.quickAction) {
    throw new Error("Cloudflare Browser Run 尚未設定");
  }
  const response = await browser.quickAction("content", {
    url,
    gotoOptions: {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    },
    rejectResourceTypes: [
      "image",
      "media",
      "font",
      "stylesheet",
      "script",
    ],
  });
  if (!response.ok) {
    throw new Error(`${label} Browser Run HTTP ${response.status}`);
  }
  const payload = await response.json().catch(() => null);
  if (
    payload?.success !== true ||
    payload?.meta?.status !== 200 ||
    typeof payload?.result !== "string"
  ) {
    throw new Error(
      `${label}頁面載入失敗（HTTP ${payload?.meta?.status ?? "unknown"}）`,
    );
  }
  return payload.result;
}

async function fetchCoupangInventory(browser) {
  const html = await fetchCoupangPage(
    browser,
    COUPANG_SEARCH_URL,
    "酷澎 Mac mini",
  );
  return parseCoupangInventory(html);
}

async function fetchCoupangSonyInventory(browser) {
  const html = await fetchCoupangPage(
    browser,
    COUPANG_SONY_SEARCH_URL,
    "酷澎 Sony",
  );
  return parseCoupangSonyInventory(html);
}

function scheduleStatusLine(label, monitor) {
  if (!monitor?.lastSuccessAt) {
    return `${label} 排程：等待第一次執行`;
  }
  return [
    `${label} 排程：正常`,
    `最近成功：${taipeiTime(new Date(monitor.lastSuccessAt))}`,
    `連續錯誤：${monitor.consecutiveErrors}`,
  ].join("\n");
}

export async function replyForCommand(
  text,
  fetchImpl = fetch,
  statusProvider = null,
  browser = null,
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
    const appleMonitor = monitor?.apple ?? monitor;
    const costcoMonitor = monitor?.costco;
    return [
      "✅ 即時 Bot 與 Apple 頁面正常",
      "",
      formatInventorySummary(snapshot),
      "",
      scheduleStatusLine("Apple", appleMonitor),
      "",
      scheduleStatusLine("Costco", costcoMonitor),
      "",
      scheduleStatusLine("PChome", monitor?.pchome),
      "",
      scheduleStatusLine("酷澎", monitor?.coupang),
      "",
      scheduleStatusLine("酷澎 Sony", monitor?.sony),
      "",
      "自動監控：Cloudflare 每 5 分鐘檢查四站 Mac mini 與 Sony 耳機價格。",
    ].join("\n");
  }
  if (command === "/check") {
    return formatInventorySummary(await fetchInventory(fetchImpl));
  }
  if (command === "/buy") {
    return formatPurchaseMessage(await fetchInventory(fetchImpl));
  }
  if (command === "/costco") {
    return formatCostcoSummary(
      await fetchCostcoInventory(fetchImpl),
    );
  }
  if (command === "/pchome") {
    return formatPchomeSummary(
      await fetchPchomeInventory(fetchImpl),
    );
  }
  if (command === "/coupang") {
    return formatCoupangSummary(
      await fetchCoupangInventory(browser),
    );
  }
  if (command === "/sony") {
    return formatCoupangSonySummary(
      await fetchCoupangSonyInventory(browser),
    );
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
          is_disabled: Boolean(event.disablePreview),
        },
      });
    } catch (error) {
      throw new NotificationError(
        error instanceof Error ? error.message : "Telegram 通知失敗",
      );
    }
  }
}

export function buildTestNotificationEvent(
  snapshot,
  costcoSnapshot = null,
  pchomeSnapshot = null,
  coupangSnapshot = null,
) {
  const checks = [
    "✅ 主動通知通道",
    "✅ Apple 頁面解析",
    ...(costcoSnapshot ? ["✅ Costco 頁面解析"] : []),
    ...(pchomeSnapshot ? ["✅ PChome 頁面解析"] : []),
    ...(coupangSnapshot ? ["✅ 酷澎 Browser Run 解析"] : []),
    "✅ Telegram 推播",
  ];
  return {
    kind: "test",
    title: "✅ Cloudflare 後台推播測試成功",
    message: [
      "Cloudflare 直接發送｜未經 Telegram 指令",
      "",
      ...checks,
      "",
      formatInventorySummary(snapshot, {
        includePurchaseLink: false,
      }),
      ...(costcoSnapshot
        ? [
            "",
            formatCostcoSummary(costcoSnapshot, {
              includePurchaseLink: false,
            }),
          ]
        : []),
      ...(pchomeSnapshot
        ? [
            "",
            formatPchomeSummary(pchomeSnapshot, {
              includePurchaseLink: false,
            }),
          ]
        : []),
      ...(coupangSnapshot
        ? [
            "",
            formatCoupangSummary(coupangSnapshot, {
              includePurchaseLink: false,
            }),
          ]
        : []),
    ].join("\n"),
    url: APPLE_REFURB_URL,
    disablePreview: true,
  };
}

async function sendTestNotification(env) {
  const [snapshot, costcoSnapshot, pchomeSnapshot, coupangSnapshot] =
    await Promise.all([
      fetchInventory(fetch),
      fetchCostcoInventory(fetch),
      fetchPchomeInventory(fetch),
      fetchCoupangInventory(env.BROWSER),
    ]);
  await sendMonitorEvents(env, [
    buildTestNotificationEvent(
      snapshot,
      costcoSnapshot,
      pchomeSnapshot,
      coupangSnapshot,
    ),
  ]);
  return {
    snapshot,
    costcoSnapshot,
    pchomeSnapshot,
    coupangSnapshot,
  };
}

function sourceTables(source) {
  const tables = SOURCE_TABLES[source];
  if (!tables) {
    throw new Error(`未知監控來源：${source}`);
  }
  return tables;
}

async function loadMonitorState(env, source = "apple") {
  const tables = sourceTables(source);
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
    FROM ${tables.state}
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
    source = "apple",
  },
) {
  const tables = sourceTables(source);
  await env.MONITOR_DB.batch([
    env.MONITOR_DB.prepare(
      `INSERT INTO ${tables.state} (
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
      `INSERT INTO ${tables.runs} (
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
      `DELETE FROM ${tables.runs}
      WHERE id NOT IN (
        SELECT id FROM ${tables.runs} ORDER BY id DESC LIMIT 2016
      )`,
    ),
  ]);
}

function stateStatus(state) {
  return {
    initialized: state.initialized,
    consecutiveErrors: state.consecutiveErrors,
    lastRunAt: state.lastRunAt,
    lastSuccessAt: state.lastSuccessAt,
    lastError: state.lastError,
  };
}

export function buildBaselineInventoryEvent(
  snapshot,
  {
    label,
    purchaseUrl,
    formatSummary,
  },
) {
  if (snapshot.targetProducts.length === 0) {
    return null;
  }
  return {
    kind: "baseline_available",
    title: `🟢 ${label} 目前有貨`,
    message: formatSummary(snapshot, {
      includePurchaseLink: false,
    }),
    url: purchaseUrl,
    disablePreview: true,
  };
}

async function monitorStatus(env) {
  const [apple, costco, pchome, coupang, sony] = await Promise.all([
    loadMonitorState(env, "apple"),
    loadMonitorState(env, "costco"),
    loadMonitorState(env, "pchome"),
    loadMonitorState(env, "coupang"),
    loadMonitorState(env, "sony"),
  ]);
  return {
    apple: stateStatus(apple),
    costco: stateStatus(costco),
    pchome: stateStatus(pchome),
    coupang: stateStatus(coupang),
    sony: stateStatus(sony),
  };
}

export function filterInventoryEvents(events, allowedKinds = null) {
  if (!allowedKinds) {
    return events;
  }
  const allowed = new Set(allowedKinds);
  return events.filter((event) => allowed.has(event.kind));
}

async function runSourceMonitor(env, {
  source,
  label,
  sourceName,
  purchaseUrl,
  fetchSnapshot,
  formatSummary,
  notifyOnBaseline = true,
  inventoryEventKinds = null,
  sendDailyHeartbeat = true,
}) {
  const original = await loadMonitorState(env, source);
  const previousErrorCount = original.consecutiveErrors;
  const nowIso = new Date().toISOString();

  try {
    const snapshot = await fetchSnapshot(fetch);
    const result = applyInventory(
      original,
      snapshot.targetProducts,
      nowIso,
      { label },
    );
    const updated = result.state;
    const events = filterInventoryEvents(
      result.events,
      inventoryEventKinds,
    );
    if (notifyOnBaseline && !original.initialized) {
      const baselineEvent = buildBaselineInventoryEvent(snapshot, {
        label,
        purchaseUrl,
        formatSummary,
      });
      if (baselineEvent) {
        events.push(baselineEvent);
      }
    }
    const recovered = recoveryEvent(previousErrorCount, {
      label,
      source: sourceName,
    });
    if (recovered) {
      events.unshift(recovered);
    }

    const today = taipeiDate();
    if (
      sendDailyHeartbeat &&
      original.initialized &&
      updated.lastHeartbeatDate !== today
    ) {
      events.push({
        kind: "heartbeat",
        title: `💚 ${label} 監控正常`,
        message: formatSummary(snapshot, {
          includePurchaseLink: false,
        }),
        url: purchaseUrl,
        disablePreview: true,
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
      source,
    });
    console.log(
      `${sourceName} 監控成功：全部 ${snapshot.totalProductCount}，` +
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
    const result = applyMonitorError(original, message, nowIso, {
      label,
    });
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
      source,
    });
    console.error(`${sourceName} 監控失敗：${message}`);
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

export async function runScheduledMonitor(env) {
  const results = await Promise.all([
    runSourceMonitor(env, {
      source: "apple",
      label: "Apple M4 Mac mini",
      sourceName: "Apple",
      purchaseUrl: APPLE_REFURB_URL,
      fetchSnapshot: fetchInventory,
      formatSummary: formatInventorySummary,
    }),
    runSourceMonitor(env, {
      source: "costco",
      label: "Costco M4 Mac mini",
      sourceName: "Costco",
      purchaseUrl: COSTCO_DESKTOP_URL,
      fetchSnapshot: fetchCostcoInventory,
      formatSummary: formatCostcoSummary,
    }),
    runSourceMonitor(env, {
      source: "pchome",
      label: "PChome M4 Mac mini",
      sourceName: "PChome",
      purchaseUrl: PCHOME_SEARCH_URL,
      fetchSnapshot: fetchPchomeInventory,
      formatSummary: formatPchomeSummary,
    }),
    runSourceMonitor(env, {
      source: "coupang",
      label: "酷澎 M4 Mac mini",
      sourceName: "酷澎",
      purchaseUrl: COUPANG_SEARCH_URL,
      fetchSnapshot: () => fetchCoupangInventory(env.BROWSER),
      formatSummary: formatCoupangSummary,
    }),
  ]);
  return {
    ok: results.every((result) => result.ok),
    apple: results[0],
    costco: results[1],
    pchome: results[2],
    coupang: results[3],
  };
}

export async function runSonyScheduledMonitor(env) {
  return runSourceMonitor(env, {
    source: "sony",
    label: "酷澎 Sony WH-1000XM6",
    sourceName: "酷澎 Sony",
    purchaseUrl: COUPANG_SONY_SEARCH_URL,
    fetchSnapshot: () => fetchCoupangSonyInventory(env.BROWSER),
    formatSummary: formatCoupangSonySummary,
    inventoryEventKinds: ["price_drop"],
    sendDailyHeartbeat: false,
  });
}

async function handleTelegramUpdate(update, env) {
  const message = update?.message;
  if (!message?.text || message.chat?.id === undefined) {
    return;
  }
  if (String(message.chat.id) !== String(env.TELEGRAM_CHAT_ID)) {
    return;
  }

  const command = normalizeText(message.text)
    .split(/\s+/, 1)[0]
    .split("@", 1)[0]
    .toLowerCase();
  if (command === "/test") {
    try {
      await sendTestNotification(env);
    } catch (error) {
      await telegramRequest(env, "sendMessage", {
        chat_id: message.chat.id,
        text: [
          "⚠️ Cloudflare 監控測試失敗",
          error instanceof Error ? error.message : "未知錯誤",
        ].join("\n\n"),
      });
    }
    return;
  }

  let reply;
  try {
    reply = await replyForCommand(
      message.text,
      fetch,
      () => monitorStatus(env),
      env.BROWSER,
    );
  } catch (error) {
    const fallbackUrl = {
      "/costco": COSTCO_DESKTOP_URL,
      "/pchome": PCHOME_SEARCH_URL,
      "/coupang": COUPANG_SEARCH_URL,
      "/sony": COUPANG_SONY_SEARCH_URL,
    }[command] ?? APPLE_REFURB_URL;
    reply = [
      "⚠️ 即時查詢暫時失敗",
      error instanceof Error ? error.message : "未知錯誤",
      "",
      `你仍可直接查看：${fallbackUrl}`,
    ].join("\n");
  }
  await telegramRequest(env, "sendMessage", {
    chat_id: message.chat.id,
    text: reply,
    link_preview_options: {
      is_disabled: command !== "/buy",
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
        scheduler: {
          macMini: MAC_MONITOR_CRON,
          sony: SONY_MONITOR_CRON,
        },
        monitor,
      });
    }
    if (request.method === "POST" && url.pathname === "/admin/test") {
      if (
        request.headers.get("Authorization") !==
        `Bearer ${env.ADMIN_TEST_TOKEN}`
      ) {
        return new Response("Unauthorized", { status: 401 });
      }
      try {
        const {
          snapshot,
          costcoSnapshot,
          pchomeSnapshot,
          coupangSnapshot,
        } =
          await sendTestNotification(env);
        return Response.json({
          ok: true,
          sent: true,
          apple: {
            totalProductCount: snapshot.totalProductCount,
            macProductCount: snapshot.macProductCount,
            macMiniCount: snapshot.macMiniCount,
            targetProductCount: snapshot.targetProducts.length,
          },
          costco: {
            totalProductCount: costcoSnapshot.totalProductCount,
            macProductCount: costcoSnapshot.macProductCount,
            macMiniCount: costcoSnapshot.macMiniCount,
            targetProductCount:
              costcoSnapshot.targetProducts.length,
          },
          pchome: {
            totalProductCount: pchomeSnapshot.totalProductCount,
            macProductCount: pchomeSnapshot.macProductCount,
            macMiniCount: pchomeSnapshot.macMiniCount,
            targetProductCount:
              pchomeSnapshot.targetProducts.length,
          },
          coupang: {
            totalProductCount: coupangSnapshot.totalProductCount,
            macProductCount: coupangSnapshot.macProductCount,
            macMiniCount: coupangSnapshot.macMiniCount,
            targetProductCount:
              coupangSnapshot.targetProducts.length,
          },
        });
      } catch (error) {
        console.error(
          `後台測試失敗：${
            error instanceof Error ? error.message : "unknown"
          }`,
        );
        return Response.json(
          {
            ok: false,
            error: "Notification test failed",
          },
          { status: 502 },
        );
      }
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

  async scheduled(controller, env, context) {
    const task = controller.cron === SONY_MONITOR_CRON
      ? runSonyScheduledMonitor(env)
      : runScheduledMonitor(env);
    context.waitUntil(task);
  },
};

export {
  APPLE_REFURB_URL,
  COSTCO_DESKTOP_URL,
  COUPANG_SEARCH_URL,
  COUPANG_SONY_SEARCH_URL,
  MAC_MONITOR_CRON,
  PCHOME_SEARCH_URL,
  SONY_MONITOR_CRON,
};
