import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTigerairPromotions,
  assertTigerairBannerFeedUrl,
  assertTigerairOfferUrl,
  buildTigerairBaselineEvent,
  parseTigerairBannerFeed,
  parseTigerairHomepage,
  parseTigerairPromotionDetail,
  tigerairSnapshot,
} from "./tigerair-promotions.js";
import { emptyMonitorState } from "./monitor-state.js";

const homepageHtml = `
  <main>
    <a class="q-carousel__slide"
      href="https://www.tigerairtw.com/zh-TW/EVENTS/2607tigeresg/"></a>
    <h2>最新活動推薦</h2>
    <a href="https://booking.tigerairtw.com/zh-TW/portal/credit-card/test">
      <div>全航線購票優惠最優 95 折</div>
      <div>活動期間至 2026/9/30</div>
    </a>
    <a href="https://hotel.example.com/deal">
      <div>日本飯店開幕限定優惠</div>
    </a>
    <h2>最新消息</h2>
    <a href="/zh-TW/news/260729">冬季航班優惠明日開賣</a>
  </main>
`;

const currentPromotionHtml = `
  <html><head>
    <title>🐯世界老虎日，一起愛老虎！台虎全航線優惠 TWD 1,199 起</title>
    <meta name="description"
      content="7/29 購買台灣虎航機票，一起加入守護老虎行列">
  </head><body></body></html>
`;

test("accepts only official Tigerair offer URL shapes", () => {
  assert.equal(
    assertTigerairOfferUrl(
      "https://www.tigerairtw.com/zh-TW/EVENTS/2607tigeresg/",
    ).hostname,
    "www.tigerairtw.com",
  );
  assert.throws(
    () => assertTigerairOfferUrl(
      "https://www.tigerairtw.com/zh-TW/index",
    ),
    /來源不符/,
  );
  assert.throws(
    () => assertTigerairOfferUrl(
      "https://tigerairtw.com.example.org/zh-TW/news/1",
    ),
    /來源不符/,
  );
});

test("extracts current official events from the homepage banner feed", () => {
  assert.equal(
    assertTigerairBannerFeedUrl(
      "https://api-cms.tigerairtw.com/api/home-banners?language=zh-TW&perPage=100",
    ).hostname,
    "api-cms.tigerairtw.com",
  );
  assert.throws(
    () => assertTigerairBannerFeedUrl(
      "https://api-cms.tigerairtw.com/api/home-banners?language=en-US&perPage=100",
    ),
    /來源不符/,
  );

  const detailUrls = parseTigerairBannerFeed({
    data: {
      homeBanners: {
        data: [
          {
            attributes: {
              linkTo: {
                url: "https://partner.example.com/tigerair-sale",
              },
            },
          },
          {
            attributes: {
              linkTo: {
                url: "https://www.tigerairtw.com/zh-TW/EVENTS/2607tigeresg/",
              },
            },
          },
          {
            attributes: {
              linkTo: {
                url: "https://static.tigerairtw.com/www/events/2607KMQ/",
              },
            },
          },
        ],
      },
    },
  });

  assert.deepEqual(detailUrls, [
    "https://www.tigerairtw.com/zh-TW/EVENTS/2607tigeresg/",
    "https://static.tigerairtw.com/www/events/2607KMQ/",
  ]);
});

test("extracts official fare offers and excludes unrelated partners", () => {
  const result = parseTigerairHomepage(homepageHtml);

  assert.equal(result.detailUrls.length, 1);
  assert.equal(result.promotions.length, 2);
  assert.match(result.promotions[0].name, /全航線購票優惠/);
  assert.match(result.promotions[1].name, /冬季航班優惠/);
  assert.doesNotMatch(
    result.promotions.map((item) => item.name).join(" "),
    /飯店/,
  );
});

test("verifies the latest official fare detail and rejects non-fare events", () => {
  const promotion = parseTigerairPromotionDetail(
    currentPromotionHtml,
    "https://www.tigerairtw.com/zh-TW/EVENTS/2607tigeresg/",
  );
  const rejected = parseTigerairPromotionDetail(
    "<title>日本品牌大使分享會</title>",
    "https://static.tigerairtw.com/www/events/2606ambassador/",
  );

  assert.match(promotion.name, /1,199/);
  assert.match(promotion.description, /7\/29/);
  assert.equal(rejected, null);
});

test("builds a quiet baseline then emits only new or changed offers", () => {
  const snapshot = tigerairSnapshot(homepageHtml, [{
    url: "https://www.tigerairtw.com/zh-TW/EVENTS/2607tigeresg/",
    html: currentPromotionHtml,
  }]);
  const baseline = applyTigerairPromotions(
    emptyMonitorState(),
    snapshot.targetProducts,
    "2026-07-28T12:00:00.000Z",
  );
  const unchanged = applyTigerairPromotions(
    baseline.state,
    snapshot.targetProducts,
    "2026-07-28T12:05:00.000Z",
  );
  const changedItems = snapshot.targetProducts.map((item, index) =>
    index === 0
      ? {
          ...item,
          description: `${item.description} 更新`,
          fingerprint: `${item.fingerprint}|updated`,
        }
      : item
  );
  const changed = applyTigerairPromotions(
    unchanged.state,
    changedItems,
    "2026-07-28T12:10:00.000Z",
  );
  const added = applyTigerairPromotions(
    changed.state,
    [
      ...changedItems,
      {
        sku: "https://www.tigerairtw.com/zh-tw/news/new-sale",
        name: "新航線優惠開賣",
        description: "",
        details: "台灣虎航官網優惠消息",
        url: "https://www.tigerairtw.com/zh-TW/news/new-sale",
        kind: "official-news",
        fingerprint: "new-sale",
      },
    ],
    "2026-07-28T12:15:00.000Z",
  );

  assert.equal(baseline.events.length, 0);
  assert.ok(buildTigerairBaselineEvent(snapshot));
  assert.equal(unchanged.events.length, 0);
  assert.equal(changed.events[0].kind, "promotion_updated");
  assert.equal(added.events[0].kind, "new_promotion");
});
