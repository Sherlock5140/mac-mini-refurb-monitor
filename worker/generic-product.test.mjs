import assert from "node:assert/strict";
import test from "node:test";

import {
  genericProductSnapshot,
  parseGenericProductPage,
  validatePublicProductUrl,
} from "./generic-product.js";

function productPage({
  name = "測試商品",
  sku = "SKU-123",
  price = 1999,
  currency = "TWD",
  availability = "https://schema.org/InStock",
  url = "https://shop.example.com/products/sku-123",
} = {}) {
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    sku,
    url,
    offers: {
      "@type": "Offer",
      price,
      priceCurrency: currency,
      availability,
      url,
    },
  })}</script>`;
}

test("accepts a public HTTPS product URL and blocks private targets", () => {
  assert.equal(
    validatePublicProductUrl("https://shop.example.com/item/1").href,
    "https://shop.example.com/item/1",
  );
  assert.throws(
    () => validatePublicProductUrl("http://shop.example.com/item/1"),
    /只接受/,
  );
  assert.throws(
    () => validatePublicProductUrl("https://127.0.0.1/item/1"),
    /不接受/,
  );
  assert.throws(
    () => validatePublicProductUrl("https://192.168.1.2/item/1"),
    /不接受/,
  );
});

test("parses one TWD JSON-LD product into a monitor snapshot", () => {
  const product = parseGenericProductPage(
    productPage(),
    "https://shop.example.com/products/sku-123",
  );
  const snapshot = genericProductSnapshot(product, "custom-test");

  assert.equal(product.name, "測試商品");
  assert.equal(product.priceTwd, 1999);
  assert.equal(product.available, true);
  assert.equal(snapshot.targetProducts.length, 1);
  assert.equal(snapshot.targetProducts[0].sku, "GENERIC-custom-test");
});

test("keeps a valid out-of-stock product as an empty observation", () => {
  const product = parseGenericProductPage(
    productPage({
      availability: "https://schema.org/OutOfStock",
    }),
    "https://shop.example.com/products/sku-123",
  );

  assert.equal(product.available, false);
  assert.equal(
    genericProductSnapshot(product, "custom-test").targetProducts.length,
    0,
  );
});

test("rejects foreign currency and ambiguous multi-product pages", () => {
  assert.throws(
    () => parseGenericProductPage(
      productPage({ currency: "USD" }),
      "https://shop.example.com/products/sku-123",
    ),
    /只支援 TWD/,
  );
  assert.throws(
    () => parseGenericProductPage(
      productPage({ name: "商品 A" }) +
        productPage({ name: "商品 B", sku: "SKU-456" }),
      "https://shop.example.com/search",
    ),
    /多項商品/,
  );
});
