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
  const privateIpv4 = ipv4 && (
    Number(ipv4[1]) === 10 ||
    Number(ipv4[1]) === 127 ||
    (Number(ipv4[1]) === 169 && Number(ipv4[2]) === 254) ||
    (Number(ipv4[1]) === 172 && Number(ipv4[2]) >= 16 && Number(ipv4[2]) <= 31) ||
    (Number(ipv4[1]) === 192 && Number(ipv4[2]) === 168)
  );
  if (
    blockedNames.has(hostname) ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    privateIpv4 ||
    hostname === "::1" ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    hostname.startsWith("fe80:")
  ) {
    throw new Error("不接受本機、內部網路或私有 IP 網址");
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
      if (!name || !Number.isFinite(price) || price <= 0 || !currency) {
        return [];
      }
      return [{ product, offer, name, price, currency }];
    })
  );
  if (candidates.length === 0) {
    throw new Error("頁面沒有可驗證的 Product JSON-LD 名稱與價格");
  }
  const uniqueNames = new Set(candidates.map((item) => item.name));
  if (uniqueNames.size !== 1) {
    throw new Error("頁面包含多項商品，需要專用網站 adapter");
  }
  const candidate = candidates[0];
  if (candidate.currency !== "TWD") {
    throw new Error(`目前通用新增只支援 TWD，偵測到 ${candidate.currency}`);
  }
  const availability = normalize(candidate.offer.availability).toLowerCase();
  const available = !availability ||
    !/(?:outofstock|soldout|discontinued)/i.test(availability);
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
