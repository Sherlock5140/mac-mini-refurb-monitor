function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function visitProducts(value, products) {
  if (Array.isArray(value)) {
    value.forEach((item) => visitProducts(item, products));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (value["@type"] === "Product" || value["@type"]?.includes?.("Product")) {
    products.push(value);
  }
  if (value["@graph"] !== undefined) {
    visitProducts(value["@graph"], products);
  }
}

export function validatePublicProductUrl(value) {
  let url;
  try {
    url = new URL(normalize(value));
  } catch {
    throw new Error("請提供完整的 HTTPS 商品網址");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new Error("只接受不含帳密與特殊連接埠的 HTTPS 網址");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const blockedNames = new Set([
    "localhost",
    "localhost.localdomain",
    "metadata.google.internal",
  ]);
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  const literalIp = Boolean(ipv4) || hostname.includes(":");
  if (
    blockedNames.has(hostname) ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    literalIp
  ) {
    throw new Error("不接受本機、內部網路或 IP 位址");
  }
  return url;
}

function productOffers(product) {
  const offers = Array.isArray(product?.offers)
    ? product.offers
    : [product?.offers];
  return offers.filter((offer) => offer && typeof offer === "object");
}

export function parseGenericProductPage(html, pageUrl) {
  const products = [];
  const pattern =
    /<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of String(html ?? "").matchAll(pattern)) {
    try {
      visitProducts(JSON.parse(match[1].trim()), products);
    } catch {
      // Ignore unrelated malformed JSON-LD blocks.
    }
  }
  const candidates = products.flatMap((product) =>
    productOffers(product).flatMap((offer) => {
      const name = normalize(product.name);
      const price = Number(offer.price ?? offer.lowPrice);
      const currency = normalize(offer.priceCurrency).toUpperCase();
      const availability = normalize(offer.availability).toLowerCase();
      if (
        !name ||
        !Number.isFinite(price) ||
        price <= 0 ||
        !currency ||
        !availability
      ) {
        return [];
      }
      return [{
        product,
        offer,
        name,
        price,
        currency,
        availability,
      }];
    })
  );
  if (candidates.length === 0) {
    throw new Error(
      "頁面沒有可驗證的 Product JSON-LD 名稱、價格、貨幣與庫存",
    );
  }
  const uniqueNames = new Set(candidates.map((item) => item.name));
  if (uniqueNames.size !== 1) {
    throw new Error("頁面包含多項商品，需要專用網站 adapter");
  }
  const signatures = new Map(candidates.map((item) => [
    [
      item.name,
      item.price,
      item.currency,
      item.availability,
      normalize(item.offer.sku ?? item.product.sku),
      normalize(item.offer.url ?? item.product.url ?? pageUrl),
    ].join("|"),
    item,
  ]));
  if (signatures.size !== 1) {
    throw new Error("頁面包含多個不同 Offer，需要專用網站 adapter");
  }
  const candidate = [...signatures.values()][0];
  if (candidate.currency !== "TWD") {
    throw new Error(`目前通用新增只支援 TWD，偵測到 ${candidate.currency}`);
  }
  const availableStates =
    /(?:instock|limitedavailability|onlineonly|preorder|presale)$/i;
  const unavailableStates =
    /(?:outofstock|soldout|discontinued)$/i;
  let available;
  if (availableStates.test(candidate.availability)) {
    available = true;
  } else if (unavailableStates.test(candidate.availability)) {
    available = false;
  } else {
    throw new Error("Product JSON-LD 庫存狀態不明，需要專用網站 adapter");
  }
  const stableId = normalize(
    candidate.offer.sku ??
    candidate.product.sku ??
    candidate.product.productID ??
    candidate.product.mpn ??
    pageUrl,
  );
  const productUrl = validatePublicProductUrl(
    new URL(
      candidate.offer.url ?? candidate.product.url ?? pageUrl,
      pageUrl,
    ).href,
  ).href;
  return {
    name: candidate.name,
    stableId,
    priceTwd: candidate.price,
    currency: candidate.currency,
    available,
    url: productUrl,
  };
}

export function genericProductSnapshot(product, targetId) {
  return {
    totalProductCount: 1,
    macProductCount: 0,
    macMiniCount: 0,
    deviceCounts: [],
    targetProducts: product.available
      ? [{
          sku: `GENERIC-${targetId}`,
          name: product.name,
          details: `${product.currency}｜公開商品頁`,
          priceTwd: product.priceTwd,
          url: product.url,
        }]
      : [],
  };
}
