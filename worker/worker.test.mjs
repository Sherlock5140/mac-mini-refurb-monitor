import assert from "node:assert/strict";
import test from "node:test";

import {
  APPLE_REFURB_URL,
  COUPANG_SEARCH_URL,
  COUPANG_SONY_SEARCH_URL,
  COSTCO_DESKTOP_URL,
  PCHOME_SEARCH_URL,
  buildBaselineInventoryEvent,
  buildTestNotificationEvent,
  default as worker,
  formatInventorySummary,
  formatCoupangSummary,
  formatCoupangSonySummary,
  formatCostcoSummary,
  formatPchomeSummary,
  formatPurchaseMessage,
  formatMonitorTargets,
  claimAiChatAllowance,
  interpretNaturalLanguage,
  loadMonitorTargets,
  manageMonitorTargets,
  parseAppleInventory,
  parseWithAiDiagnostics,
  parseCoupangInventory,
  parseCoupangSonyInventory,
  parseCostcoInventory,
  parsePchomeInventory,
  replyForCommand,
  replyForNaturalLanguage,
  filterInventoryEvents,
} from "./worker.js";
import {
  applyInventory,
  applyMonitorError,
  emptyMonitorState,
  recoveryEvent,
} from "./monitor-state.js";

function managementDbFixture() {
  const targets = [
    {
      id: "apple-mac-mini",
      label: "Apple M4 Mac mini",
      adapter_key: "apple-refurb-mac",
      source_url: APPLE_REFURB_URL,
      config_json: "{}",
      enabled: 1,
      created_at: "2026-07-28T00:00:00.000Z",
      updated_at: "2026-07-28T00:00:00.000Z",
      deleted_at: null,
    },
    {
      id: "coupang-sony-xm6",
      label: "酷澎 Sony WH-1000XM6",
      adapter_key: "coupang-browser-search",
      source_url: COUPANG_SONY_SEARCH_URL,
      config_json: '{"notification_events":["price_drop"]}',
      enabled: 1,
      created_at: "2026-07-28T00:00:00.000Z",
      updated_at: "2026-07-28T00:00:00.000Z",
      deleted_at: null,
    },
  ];
  const requests = [];
  const audit = [];

  function statement(sql, values = []) {
    return {
      sql,
      values,
      bind(...bound) {
        return statement(sql, bound);
      },
      async all() {
        if (sql.includes("FROM monitor_targets")) {
          const includeDeleted = !sql.includes("WHERE deleted_at IS NULL");
          return {
            results: targets.filter(
              (target) => includeDeleted || !target.deleted_at,
            ),
          };
        }
        return { results: [] };
      },
      async first() {
        if (sql.includes("FROM monitor_change_requests")) {
          return requests.find(
            (request) =>
              request.confirmation_code === values[0] &&
              request.status === "pending",
          ) ?? null;
        }
        return null;
      },
    };
  }

  function apply(item) {
    const { sql, values } = item;
    if (sql.includes("SET enabled = ?, updated_at = ?")) {
      const target = targets.find((entry) => entry.id === values[2]);
      target.enabled = values[0];
      target.updated_at = values[1];
    } else if (
      sql.includes("INSERT INTO monitor_change_requests")
    ) {
      requests.push({
        id: requests.length + 1,
        confirmation_code: values[0],
        action: "remove",
        target_id: values[1],
        status: "pending",
        expires_at: values[2],
        created_at: values[3],
      });
    } else if (
      sql.includes("SET status = 'expired'")
    ) {
      for (const request of requests) {
        if (
          request.target_id === values[0] &&
          request.status === "pending"
        ) {
          request.status = "expired";
        }
      }
    } else if (
      sql.includes("SET enabled = 0, deleted_at = ?")
    ) {
      const target = targets.find((entry) => entry.id === values[2]);
      target.enabled = 0;
      target.deleted_at = values[0];
      target.updated_at = values[1];
    } else if (
      sql.includes("SET status = 'confirmed'")
    ) {
      const request = requests.find((entry) => entry.id === values[1]);
      request.status = "confirmed";
      request.confirmed_at = values[0];
    } else if (sql.includes("INSERT INTO monitor_audit_log")) {
      audit.push({ sql, values });
    }
  }

  return {
    targets,
    requests,
    audit,
    prepare: statement,
    async batch(statements) {
      statements.forEach(apply);
      return [];
    },
  };
}

function product({
  name,
  description = "16GB 統一記憶體 256GB SSD",
  sku,
  price = 17000,
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    description,
    url: `https://www.apple.com/tw/shop/product/${sku.toLowerCase()}`,
    offers: {
      "@type": "Offer",
      sku,
      price,
      priceCurrency: "TWD",
    },
  };
}

function htmlFor(...products) {
  return products
    .map(
      (item) =>
        `<script type="application/ld+json">${JSON.stringify(item)}</script>`,
    )
    .join("");
}

const sampleHtml = htmlFor(
  product({
    name: "Mac mini Apple M4 晶片配備 10 核心 CPU (整修品)",
    sku: "FMINITA/A",
  }),
  product({
    name: "24 吋 iMac Apple M4 晶片 (整修品)",
    sku: "FIMACTA/A",
  }),
  product({
    name: "14 吋 MacBook Pro Apple M4 Pro 晶片 (整修品)",
    sku: "FMBPTA/A",
  }),
);

function costcoCard({
  name,
  sku,
  price,
  available = true,
}) {
  const slug = name.replaceAll(" ", "-");
  return [
    '<sip-product-list-item class="product-item">',
    `<a class="thumb" title="${name}" href="/Digital-Mobile/${slug}/p/${sku}"></a>`,
    '<span class="product-price-amount">',
    `<span>$${price.toLocaleString("en-US")}</span>`,
    "</span>",
    available
      ? '<button class="add-to-cart__btn">加入購物車</button>'
      : "<span>缺貨</span>",
    `<input name="productCodePost" value="${sku}">`,
    "</sip-product-list-item>",
  ].join("");
}

const costcoHtml = [
  costcoCard({
    name: "Apple Mac mini Apple M4晶片 16GB 512GB SSD",
    sku: "149621",
    price: 31999,
  }),
  costcoCard({
    name: "Apple Mac mini Apple M4 Pro晶片 24GB 512GB SSD",
    sku: "149999",
    price: 49999,
  }),
  costcoCard({
    name: "Apple iMac Apple M4晶片 16GB 256GB SSD",
    sku: "149888",
    price: 39999,
  }),
].join("");

function pchomeCard({
  name,
  sku,
  price,
  available = true,
}) {
  return [
    '<div class="c-prodInfoV2 c-prodInfoV2--gridCard" data-soldout="false">',
    `<a class="c-prodInfoV2__link" href="/prod/${sku}">`,
    `<h3 title="${name}" data-regression="store_prodName">${name}</h3>`,
    `<div class="c-prodInfoV2__priceValue c-prodInfoV2__priceValue--m">$${price.toLocaleString("en-US")}</div>`,
    "</a>",
    `<button ${available ? "" : "disabled "}data-regression="store_addToCart"></button>`,
    "</div>",
  ].join("");
}

const pchomeHtml = [
  pchomeCard({
    name: "Apple 蘋果 Mac mini M4 晶片配備 10 核心 CPU、10 核心 GPU、16GB記憶體 512GB SSD",
    sku: "DYAJFD-A900K5QTY",
    price: 33900,
  }),
  pchomeCard({
    name: "Apple 蘋果 Mac mini M4 晶片配備 10 核心 CPU、10 核心 GPU、24GB記憶體 512GB SSD",
    sku: "DYAJFD-A900K5QTR",
    price: 40900,
    available: false,
  }),
  pchomeCard({
    name: "Apple 蘋果 Mac mini M4 Pro 晶片配備 12 核心 CPU、24GB記憶體 512GB SSD",
    sku: "DYAJFD-A900K5QSV",
    price: 54900,
  }),
].join("");

function coupangCard({
  name,
  vendorItemId,
  productId,
  itemId = productId,
  price,
  available = true,
}) {
  return [
    `<li class="ProductUnit_productUnit__Qd6sv" data-id="${vendorItemId}">`,
    `<a href="/products/${productId}?itemId=${itemId}&amp;vendorItemId=${vendorItemId}">`,
    `<div class="ProductUnit_productNameV2__cV9cw">${name}</div>`,
    '<div class="PriceArea_priceArea__NntJz">',
    available
      ? `<span translate="no">$${price.toLocaleString("en-US")}</span>`
      : "<span>暫時缺貨</span>",
    "</div>",
    "</a>",
    "</li>",
  ].join("");
}

const coupangHtml = [
  coupangCard({
    name: "Apple Mac mini M4 10核心CPU/10核心GPU, 銀色, 16GB, 512GB, MAC OS, MU9E3TA/A",
    vendorItemId: "562856189722625",
    productId: "563199703220224",
    price: 33900,
  }),
  coupangCard({
    name: "Apple Mac mini M4 Pro 12核心CPU, 銀色, 24GB, 512GB, MAC OS",
    vendorItemId: "562856189722626",
    productId: "563199703220225",
    price: 54900,
  }),
  coupangCard({
    name: "Apple Mac mini M4 10核心CPU, 銀色, 16GB, 256GB, MAC OS",
    vendorItemId: "562856189722627",
    productId: "563199703220226",
    price: 25900,
    available: false,
  }),
].join("");

const coupangSonyHtml = [
  coupangCard({
    name: "SONY 索尼 Wireless 主動降噪 耳罩式 耳機 40H Playtime 銀色 WH-1000XM6 原廠保固12個月",
    vendorItemId: "626209201193059",
    productId: "626209205272694",
    itemId: "626209205403651",
    price: 10791,
  }),
  coupangCard({
    name: "SONY 索尼 Wireless 主動降噪 耳罩式 耳機 40H Playtime 黑色 WH-1000XM6 原廠保固12個月",
    vendorItemId: "626209205272648",
    productId: "626209205272694",
    itemId: "626209205305462",
    price: 10691,
  }),
  coupangCard({
    name: "SONY 索尼 Wireless 主動降噪 入耳式 耳機 鉑金銀色 WF-1000XM6 原廠保固12個月",
    vendorItemId: "663152630808667",
    productId: "663152630825069",
    itemId: "663152630841453",
    price: 8290,
  }),
].join("");

test("parses broad Mac counts while filtering target Mac minis", () => {
  const snapshot = parseAppleInventory(sampleHtml);

  assert.equal(snapshot.totalProductCount, 3);
  assert.equal(snapshot.macProductCount, 3);
  assert.equal(snapshot.macMiniCount, 1);
  assert.equal(snapshot.targetProducts.length, 1);
  assert.deepEqual(Object.fromEntries(snapshot.deviceCounts), {
    "Mac mini": 1,
    "MacBook Pro": 1,
    iMac: 1,
  });
});

test("does not spend Workers AI quota when deterministic parsing succeeds", async () => {
  let aiCalls = 0;
  const snapshot = await parseWithAiDiagnostics({
    ai: {
      async run() {
        aiCalls += 1;
        return { response: "{}" };
      },
    },
    source: "Apple",
    html: sampleHtml,
    parser: parseAppleInventory,
  });

  assert.equal(aiCalls, 0);
  assert.equal(snapshot.targetProducts.length, 1);
});

test("routes natural language through the GLM chat model", async () => {
  let calls = 0;
  const intent = await interpretNaturalLanguage(
    "幫我查 Sony 耳機現在多少錢",
    {
      async run(model, input) {
        calls += 1;
        assert.equal(model, "@cf/zai-org/glm-4.7-flash");
        assert.equal(input.max_completion_tokens, 180);
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: "sony",
                  reply: "",
                }),
              },
            },
          ],
        };
      },
    },
  );

  assert.equal(calls, 1);
  assert.deepEqual(intent, {
    action: "sony",
    reply: "",
  });
});

test("routes natural-language target management without inventing URLs", async () => {
  const intent = await interpretNaturalLanguage(
    "先暫停 Sony 耳機監控",
    {
      async run() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: "pause",
                  target: "Sony",
                  reply: "",
                }),
              },
            },
          ],
        };
      },
    },
  );

  assert.deepEqual(intent, {
    action: "pause",
    target: "Sony",
    reply: "",
  });
});

test("lists, pauses, resumes, and confirm-removes registered targets", async () => {
  const db = managementDbFixture();
  const initialTargets = await loadMonitorTargets(db);

  assert.equal(initialTargets.length, 2);
  assert.match(formatMonitorTargets(initialTargets), /Apple M4 Mac mini/);
  assert.match(await manageMonitorTargets("/pause Sony", db), /已暫停/);
  assert.equal(db.targets[1].enabled, 0);
  assert.match(await manageMonitorTargets("/resume Sony", db), /已恢復/);
  assert.equal(db.targets[1].enabled, 1);

  const removalReply = await manageMonitorTargets("/remove Sony", db);
  const code = removalReply.match(/\/confirm ([A-F0-9]{6})/)?.[1];
  assert.ok(code);
  assert.equal(db.targets[1].deleted_at, null);

  const confirmationReply = await manageMonitorTargets(
    `/confirm ${code}`,
    db,
  );
  assert.match(confirmationReply, /已移除監控目標/);
  assert.equal(db.targets[1].enabled, 0);
  assert.ok(db.targets[1].deleted_at);
  assert.equal(db.audit.length, 3);
});

test("tracks a conservative daily AI chat allowance", async () => {
  const bindings = [];
  const db = {
    prepare() {
      return {
        bind(...values) {
          bindings.push(values);
          return {
            async first() {
              return { request_count: 7 };
            },
          };
        },
      };
    },
  };
  const allowance = await claimAiChatAllowance(
    db,
    new Date("2026-07-26T13:00:00.000Z"),
  );

  assert.deepEqual(allowance, {
    allowed: true,
    remaining: 33,
  });
  assert.equal(bindings[0][0], "2026-07-26");
  assert.equal(bindings[0][2], 40);
});

test("natural-language chat falls back when the local free quota is exhausted", async () => {
  let aiCalls = 0;
  const env = {
    AI: {
      async run() {
        aiCalls += 1;
        return {};
      },
    },
    MONITOR_DB: {
      prepare() {
        return {
          bind() {
            return {
              async first() {
                return null;
              },
            };
          },
        };
      },
    },
  };
  const reply = await replyForNaturalLanguage("你好", env);

  assert.equal(aiCalls, 0);
  assert.match(reply, /今日免費 AI 對話額度已用完/);
  assert.match(reply, /\/status/);
});

test("uses Workers AI only to diagnose a deterministic parser failure", async () => {
  let aiCalls = 0;
  const ai = {
    async run(model, input) {
      aiCalls += 1;
      assert.equal(model, "@cf/meta/llama-3.2-1b-instruct");
      assert.equal(input.max_tokens, 80);
      return {
        response: JSON.stringify({
          state: "changed",
          confidence: 0.92,
          summary: "頁面結構可能已變更",
        }),
      };
    },
  };

  await assert.rejects(
    parseWithAiDiagnostics({
      ai,
      source: "Apple",
      html: "<html><body>Mac 商品清單載入格式已更新</body></html>",
      parser: parseAppleInventory,
    }),
    /AI 輔助判讀：頁面結構可能已變更/,
  );
  assert.equal(aiCalls, 1);
});

test("formats inventory and purchase links", () => {
  const snapshot = parseAppleInventory(sampleHtml);
  const summary = formatInventorySummary(snapshot);

  assert.match(summary, /符合條件：1 項/);
  assert.match(summary, /Mac mini 總數：1 項/);
  assert.match(summary, /• MacBook Pro：1 項/);
  assert.match(summary, new RegExp(APPLE_REFURB_URL));
  assert.ok(
    summary.indexOf("🎯 監控結果") <
      summary.indexOf("📊 頁面概況"),
  );
  assert.match(formatPurchaseMessage(snapshot), /NT\$17,000/);
  assert.match(formatPurchaseMessage(snapshot), /fminita\/a/);
});

test("parses Costco cards and excludes M4 Pro Mac minis", () => {
  const snapshot = parseCostcoInventory(costcoHtml);

  assert.equal(snapshot.totalProductCount, 3);
  assert.equal(snapshot.macProductCount, 3);
  assert.equal(snapshot.macMiniCount, 2);
  assert.equal(snapshot.targetProducts.length, 1);
  assert.deepEqual(snapshot.targetProducts[0], {
    sku: "COSTCO-149621",
    name: "Apple Mac mini Apple M4晶片 16GB 512GB SSD",
    storageGb: 512,
    memoryGb: 16,
    priceTwd: 31999,
    url: "https://www.costco.com.tw/Digital-Mobile/Apple-Mac-mini-Apple-M4%E6%99%B6%E7%89%87-16GB-512GB-SSD/p/149621",
  });
});

test("formats Costco live stock and purchase links", () => {
  const summary = formatCostcoSummary(
    parseCostcoInventory(costcoHtml),
  );

  assert.match(summary, /符合條件且有貨：1 項/);
  assert.match(summary, /512GB｜NT\$31,999｜有貨/);
  assert.match(summary, new RegExp(COSTCO_DESKTOP_URL));
});

test("does not treat a visible Costco out-of-stock card as available", () => {
  const snapshot = parseCostcoInventory(
    costcoCard({
      name: "Apple Mac mini Apple M4晶片 16GB 256GB SSD",
      sku: "149620",
      price: 18799,
      available: false,
    }),
  );

  assert.equal(snapshot.macMiniCount, 1);
  assert.equal(snapshot.targetProducts.length, 0);
});

test("parses PChome stock and excludes sold-out or Pro models", () => {
  const snapshot = parsePchomeInventory(pchomeHtml);

  assert.equal(snapshot.totalProductCount, 3);
  assert.equal(snapshot.macMiniCount, 3);
  assert.equal(snapshot.targetProducts.length, 1);
  assert.deepEqual(snapshot.targetProducts[0], {
    sku: "PCHOME-DYAJFD-A900K5QTY",
    name: "Apple 蘋果 Mac mini M4 晶片配備 10 核心 CPU、10 核心 GPU、16GB記憶體 512GB SSD",
    storageGb: 512,
    memoryGb: 16,
    priceTwd: 33900,
    url: "https://24h.pchome.com.tw/prod/DYAJFD-A900K5QTY",
  });
});

test("formats PChome live stock and purchase links", () => {
  const summary = formatPchomeSummary(
    parsePchomeInventory(pchomeHtml),
  );

  assert.match(summary, /符合條件且有貨：1 項/);
  assert.match(summary, /512GB｜NT\$33,900｜有貨/);
  assert.ok(summary.includes(PCHOME_SEARCH_URL));
});

test("parses Coupang rendered cards and excludes sold-out or Pro models", () => {
  const snapshot = parseCoupangInventory(coupangHtml);

  assert.equal(snapshot.totalProductCount, 3);
  assert.equal(snapshot.macProductCount, 3);
  assert.equal(snapshot.macMiniCount, 3);
  assert.equal(snapshot.targetProducts.length, 1);
  assert.deepEqual(snapshot.targetProducts[0], {
    sku: "COUPANG-562856189722625",
    name: "Apple Mac mini M4 10核心CPU/10核心GPU, 銀色, 16GB, 512GB, MAC OS, MU9E3TA/A",
    storageGb: 512,
    memoryGb: 16,
    priceTwd: 33900,
    url: "https://www.tw.coupang.com/products/563199703220224?itemId=563199703220224&vendorItemId=562856189722625",
  });
});

test("formats Coupang live stock and purchase links", () => {
  const summary = formatCoupangSummary(
    parseCoupangInventory(coupangHtml),
  );

  assert.match(summary, /酷澎 M4 Mac mini 即時查詢/);
  assert.match(summary, /符合條件且有貨：1 項/);
  assert.match(summary, /512GB｜NT\$33,900｜有貨/);
  assert.ok(summary.includes(COUPANG_SEARCH_URL));
});

test("parses only the exact silver Sony WH-1000XM6 target", () => {
  const snapshot = parseCoupangSonyInventory(coupangSonyHtml);

  assert.equal(snapshot.totalProductCount, 3);
  assert.equal(snapshot.targetProducts.length, 1);
  assert.deepEqual(snapshot.targetProducts[0], {
    sku: "SONY-626209205403651",
    name: "SONY 索尼 Wireless 主動降噪 耳罩式 耳機 40H Playtime 銀色 WH-1000XM6 原廠保固12個月",
    details: "銀色｜WH-1000XM6｜原廠保固 12 個月",
    priceTwd: 10791,
    url: "https://www.tw.coupang.com/products/626209205272694?itemId=626209205403651&vendorItemId=626209201193059",
  });
});

test("formats the Sony price tracker and direct purchase link", () => {
  const summary = formatCoupangSonySummary(
    parseCoupangSonyInventory(coupangSonyHtml),
  );

  assert.match(summary, /Sony WH-1000XM6 降價追蹤/);
  assert.match(summary, /NT\$10,791/);
  assert.match(summary, /價格不變不重複通知/);
  assert.ok(summary.includes(COUPANG_SONY_SEARCH_URL));
});

test("Sony tracker keeps only price-drop inventory events", () => {
  const events = [
    { kind: "new" },
    { kind: "price_drop" },
    { kind: "removed" },
  ];

  assert.deepEqual(
    filterInventoryEvents(events, ["price_drop"]),
    [{ kind: "price_drop" }],
  );
});

test("backend test notifications contain one compact purchase link", () => {
  const event = buildTestNotificationEvent(
    parseAppleInventory(sampleHtml),
  );
  const finalText = `${event.title}\n\n${event.message}\n\n${event.url}`;
  const linkMatches = finalText.match(
    new RegExp(APPLE_REFURB_URL, "g"),
  );

  assert.equal(linkMatches.length, 1);
  assert.equal(event.disablePreview, true);
  assert.doesNotMatch(event.message, /購買頁/);
  assert.ok(
    event.message.indexOf("✅ 主動通知通道") <
      event.message.indexOf("🎯 監控結果"),
  );
});

test("first baseline reports matching inventory without calling it new", () => {
  const snapshot = parseCoupangInventory(coupangHtml);
  const event = buildBaselineInventoryEvent(snapshot, {
    label: "酷澎 M4 Mac mini",
    purchaseUrl: COUPANG_SEARCH_URL,
    formatSummary: formatCoupangSummary,
  });

  assert.equal(event.kind, "baseline_available");
  assert.match(event.title, /目前有貨/);
  assert.doesNotMatch(event.title, /新上架/);
  assert.match(event.message, /NT\$33,900/);
  assert.equal(event.url, COUPANG_SEARCH_URL);
});

test("first baseline stays quiet when no product matches", () => {
  const snapshot = {
    ...parseCoupangInventory(coupangHtml),
    targetProducts: [],
  };
  const event = buildBaselineInventoryEvent(snapshot, {
    label: "酷澎 M4 Mac mini",
    purchaseUrl: COUPANG_SEARCH_URL,
    formatSummary: formatCoupangSummary,
  });

  assert.equal(event, null);
});

test("answers check commands with live Apple data", async () => {
  const fakeFetch = async () =>
    new Response(sampleHtml, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });

  const reply = await replyForCommand("/check", fakeFetch);

  assert.match(reply, /符合條件：1 項/);
  assert.match(reply, /標準版 M4｜256／512GB SSD/);
  assert.match(reply, /購買頁/);
});

test("answers Costco commands with live Costco data", async () => {
  const fakeFetch = async () =>
    new Response(costcoHtml, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });

  const reply = await replyForCommand("/costco", fakeFetch);

  assert.match(reply, /Costco 台灣 M4 Mac mini/);
  assert.match(reply, /符合條件且有貨：1 項/);
  assert.match(reply, /排除 M4 Pro／Max/);
});

test("answers PChome commands with live PChome data", async () => {
  const fakeFetch = async () =>
    new Response(pchomeHtml, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });

  const reply = await replyForCommand("/pchome", fakeFetch);

  assert.match(reply, /PChome 24h M4 Mac mini/);
  assert.match(reply, /符合條件且有貨：1 項/);
});

test("answers Coupang commands through Cloudflare Browser Run", async () => {
  const fakeBrowser = {
    quickAction: async () =>
      Response.json({
        success: true,
        result: coupangHtml,
        meta: { status: 200 },
      }),
  };
  const reply = await replyForCommand(
    "/coupang",
    fetch,
    null,
    fakeBrowser,
  );

  assert.match(reply, /符合條件且有貨：1 項/);
  assert.match(reply, /NT\$33,900/);
  assert.ok(reply.includes(COUPANG_SEARCH_URL));
});

test("answers Sony commands through Cloudflare Browser Run", async () => {
  const fakeBrowser = {
    quickAction: async () =>
      Response.json({
        success: true,
        result: coupangSonyHtml,
        meta: { status: 200 },
      }),
  };
  const reply = await replyForCommand(
    "/sony",
    fetch,
    null,
    fakeBrowser,
  );

  assert.match(reply, /WH-1000XM6 降價追蹤/);
  assert.match(reply, /NT\$10,791/);
});

test("retries one blocked Coupang render before parsing Sony", async () => {
  let browserCalls = 0;
  const fakeBrowser = {
    async quickAction() {
      browserCalls += 1;
      if (browserCalls === 1) {
        return Response.json({
          success: true,
          result:
            "<html><body>Sorry! Access denied 您沒有權限存取此頁面。</body></html>",
          meta: { status: 200 },
        });
      }
      return Response.json({
        success: true,
        result: coupangSonyHtml,
        meta: { status: 200 },
      });
    },
  };

  const reply = await replyForCommand(
    "/sony",
    fetch,
    null,
    fakeBrowser,
  );

  assert.equal(browserCalls, 2);
  assert.match(reply, /NT\$10,791/);
});

test("reports an explicit Coupang block after one retry", async () => {
  let browserCalls = 0;
  const fakeBrowser = {
    async quickAction() {
      browserCalls += 1;
      return Response.json({
        success: true,
        result:
          "<html><body>Access Denied You don't have permission to access this page.</body></html>",
        meta: { status: 403 },
      });
    },
  };

  await assert.rejects(
    replyForCommand("/sony", fetch, null, fakeBrowser),
    /酷澎 Sony遭酷澎暫時拒絕 Cloudflare 存取/,
  );
  assert.equal(browserCalls, 2);
});

test("reports Cloudflare scheduler state in status commands", async () => {
  const fakeFetch = async () =>
    new Response(sampleHtml, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });

  const reply = await replyForCommand(
    "/status",
    fakeFetch,
    async () => ({
      lastSuccessAt: "2026-07-26T07:25:31.203Z",
      consecutiveErrors: 0,
    }),
  );

  assert.match(reply, /Apple 排程：正常/);
  assert.match(reply, /Costco 排程：等待第一次執行/);
  assert.match(reply, /酷澎 排程：等待第一次執行/);
  assert.match(reply, /酷澎 Sony 排程：等待第一次執行/);
  assert.match(reply, /Sony 耳機價格/);
  assert.doesNotMatch(reply, /GitHub Actions/);
});

test("lists the active notification test command", async () => {
  const reply = await replyForCommand("/help");

  assert.match(reply, /\/test－傳送一則 Cloudflare 主動通知測試/);
  assert.match(reply, /\/costco－立即查詢 Costco 台灣庫存與價格/);
  assert.match(reply, /\/pchome－立即查詢 PChome 24h 庫存與價格/);
  assert.match(reply, /\/coupang－立即查詢酷澎庫存、價格與購買連結/);
  assert.match(reply, /\/sony－立即查詢酷澎銀色 Sony WH-1000XM6 價格/);
});

test("public health response does not expose operational details", async () => {
  const response = await worker.fetch(
    new Request("https://example.com/health"),
    {},
    {},
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("rejects a product page that contains no Mac", () => {
  const iphoneHtml = htmlFor(
    product({
      name: "iPhone 17 Pro 256GB (整修品)",
      description: "256GB",
      sku: "FIPHONE/A",
    }),
  );

  assert.throws(() => parseAppleInventory(iphoneHtml), /沒有辨識到任何 Mac/);
});

test("rejects webhook requests without the Telegram secret header", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/telegram", {
      method: "POST",
      body: JSON.stringify({ message: { text: "/check" } }),
    }),
    { TELEGRAM_WEBHOOK_SECRET: "expected-secret" },
    { waitUntil() {} },
  );

  assert.equal(response.status, 401);
});

test("rejects backend notification tests without the admin token", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/admin/test", {
      method: "POST",
    }),
    { ADMIN_TEST_TOKEN: "expected-secret" },
    { waitUntil() {} },
  );

  assert.equal(response.status, 401);
});

function target({
  sku = "FMINITA/A",
  priceTwd = 17000,
} = {}) {
  return {
    sku,
    name: "Mac mini Apple M4 晶片 (整修品)",
    storageGb: 256,
    memoryGb: 16,
    priceTwd,
    url: `https://www.apple.com/tw/shop/product/${sku.toLowerCase()}`,
  };
}

test("Cloudflare first run creates a baseline without an alert", () => {
  const result = applyInventory(
    emptyMonitorState(),
    [target()],
    "2026-07-26T10:00:00.000Z",
  );

  assert.equal(result.state.initialized, true);
  assert.deepEqual(result.events, []);
});

test("Cloudflare detects new, restocked, and cheaper products", () => {
  let result = applyInventory(
    emptyMonitorState(),
    [],
    "2026-07-26T10:00:00.000Z",
  );
  result = applyInventory(
    result.state,
    [target()],
    "2026-07-26T10:05:00.000Z",
  );
  assert.deepEqual(result.events.map((item) => item.kind), ["new"]);

  result = applyInventory(
    result.state,
    [],
    "2026-07-26T10:10:00.000Z",
  );
  assert.deepEqual(result.events, []);
  result = applyInventory(
    result.state,
    [],
    "2026-07-26T10:15:00.000Z",
  );
  assert.deepEqual(result.events.map((item) => item.kind), ["removed"]);

  result = applyInventory(
    result.state,
    [target()],
    "2026-07-26T10:20:00.000Z",
  );
  assert.deepEqual(result.events.map((item) => item.kind), ["restock"]);

  result = applyInventory(
    result.state,
    [target({ priceTwd: 16000 })],
    "2026-07-26T10:25:00.000Z",
  );
  assert.deepEqual(result.events.map((item) => item.kind), ["price_drop"]);
});

test("Sony price-drop messages use headphone details", () => {
  const sony = {
    sku: "SONY-626209205403651",
    name: "SONY 索尼 WH-1000XM6",
    details: "銀色｜WH-1000XM6｜原廠保固 12 個月",
    priceTwd: 10791,
    url: COUPANG_SONY_SEARCH_URL,
  };
  let result = applyInventory(
    emptyMonitorState(),
    [sony],
    "2026-07-26T10:00:00.000Z",
  );
  result = applyInventory(
    result.state,
    [{ ...sony, priceTwd: 10591 }],
    "2026-07-26T10:05:00.000Z",
  );

  assert.equal(result.events[0].kind, "price_drop");
  assert.match(result.events[0].message, /銀色｜WH-1000XM6/);
  assert.doesNotMatch(result.events[0].message, /undefinedGB SSD/);
});

test("labels Costco inventory events separately", () => {
  let result = applyInventory(
    emptyMonitorState(),
    [],
    "2026-07-26T10:00:00.000Z",
    { label: "Costco M4 Mac mini" },
  );
  result = applyInventory(
    result.state,
    [target({ sku: "COSTCO-149621" })],
    "2026-07-26T10:05:00.000Z",
    { label: "Costco M4 Mac mini" },
  );

  assert.match(result.events[0].title, /Costco M4 Mac mini 新上架/);
});

test("Cloudflare confirms removal twice and resets a single miss", () => {
  let result = applyInventory(
    emptyMonitorState(),
    [target()],
    "2026-07-26T10:00:00.000Z",
  );
  result = applyInventory(
    result.state,
    [],
    "2026-07-26T10:05:00.000Z",
  );
  result = applyInventory(
    result.state,
    [target()],
    "2026-07-26T10:10:00.000Z",
  );

  assert.equal(result.state.products["FMINITA/A"].missingCount, 0);
  assert.deepEqual(result.events, []);
});

test("Cloudflare throttles errors and reports recovery", () => {
  let state = emptyMonitorState();
  const emitted = [];
  for (let index = 0; index < 7; index += 1) {
    const result = applyMonitorError(
      state,
      "temporary failure",
      `2026-07-26T10:${index}0:00.000Z`,
    );
    state = result.state;
    emitted.push(...result.events.map((item) => item.kind));
  }

  assert.deepEqual(emitted, ["error", "error", "error"]);
  assert.equal(recoveryEvent(7).kind, "recovered");
  assert.equal(recoveryEvent(0), null);
});

test("Coupang transient blocks notify only after three failures", () => {
  let state = emptyMonitorState();
  const emitted = [];
  for (let count = 1; count <= 6; count += 1) {
    const result = applyMonitorError(
      state,
      "酷澎暫時拒絕 Cloudflare 存取",
      `2026-07-26T13:${String(count).padStart(2, "0")}:00.000Z`,
      {
        label: "酷澎",
        notifyAt: [3, 6],
      },
    );
    state = result.state;
    emitted.push(...result.events.map((event) => event.kind));
  }

  assert.deepEqual(emitted, ["error", "error"]);
  assert.equal(
    recoveryEvent(2, {
      label: "酷澎",
      source: "酷澎",
      minimumErrorCount: 3,
    }),
    null,
  );
  assert.equal(
    recoveryEvent(3, {
      label: "酷澎",
      source: "酷澎",
      minimumErrorCount: 3,
    }).kind,
    "recovered",
  );
});
