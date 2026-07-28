import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTigerairPromotions,
  applyTigerairSaleOpenReminders,
  assertTigerairBannerFeedUrl,
  assertTigerairOfferUrl,
  buildTigerairBaselineEvent,
  formatTigerairPromotionMessage,
  formatTigerairTaipeiTime,
  parseTigerairBannerFeed,
  parseTigerairHomepage,
  parseTigerairPromotionDetail,
  parseTigerairSaleScheduleText,
  tigerairSnapshot,
  withTigerairSaleSchedule,
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
    <meta property="og:image"
      content="https://strapi-assets.tigerairtw.com/TW_M_960x420_3_5c48d4429e.jpg">
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
  assert.equal(result.promotions.length, 1);
  assert.match(result.promotions[0].name, /冬季航班優惠/);
  assert.doesNotMatch(
    result.promotions.map((item) => item.name).join(" "),
    /飯店|信用卡|95 折/,
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
  const routeLaunch = parseTigerairPromotionDetail(
    "<title>台虎直飛小松 每週各 2 班</title><meta name=\"description\" content=\"全新航線正式啟航\">",
    "https://static.tigerairtw.com/www/events/2607KMQ/",
  );
  const creditCard = parseTigerairPromotionDetail(
    "<title>銀行信用卡全航線機票 95 折優惠</title>",
    "https://www.tigerairtw.com/zh-TW/EVENTS/card-sale/",
  );

  assert.match(promotion.name, /1,199/);
  assert.match(promotion.description, /7\/29/);
  assert.match(promotion.imageUrl, /strapi-assets\.tigerairtw\.com/);
  assert.equal(rejected, null);
  assert.equal(routeLaunch, null);
  assert.equal(creditCard, null);
});

test("parses a verified Taipei sale schedule and reminds exactly once", () => {
  const schedule = parseTigerairSaleScheduleText(`
    SALE_START=2026-07-29 10:00
    SALE_END=2026-07-30 23:59
    TRAVEL_START=2026-07-29 00:00
    TRAVEL_END=2026-10-24 23:59
  `);
  assert.deepEqual(schedule, {
    saleStartAt: "2026-07-29T02:00:00.000Z",
    saleEndAt: "2026-07-30T15:59:00.000Z",
    travelStartAt: "2026-07-28T16:00:00.000Z",
    travelEndAt: "2026-10-24T15:59:00.000Z",
  });
  assert.match(
    formatTigerairTaipeiTime(schedule.saleStartAt),
    /2026\/07\/29 10:00/,
  );

  const item = withTigerairSaleSchedule(
    parseTigerairPromotionDetail(
      currentPromotionHtml,
      "https://www.tigerairtw.com/zh-TW/EVENTS/2607tigeresg/",
    ),
    schedule,
    "2026-07-28T13:00:00.000Z",
  );
  const state = emptyMonitorState();
  state.initialized = true;
  state.products[item.sku] = item;
  const early = applyTigerairSaleOpenReminders(
    state,
    "2026-07-29T01:59:59.000Z",
  );
  const opened = applyTigerairSaleOpenReminders(
    early.state,
    "2026-07-29T02:00:00.000Z",
  );
  const repeated = applyTigerairSaleOpenReminders(
    opened.state,
    "2026-07-29T02:05:00.000Z",
  );

  assert.equal(early.events.length, 0);
  assert.equal(opened.events.length, 1);
  assert.equal(opened.events[0].kind, "sale_open");
  assert.match(opened.events[0].message, /2026\/07\/29 10:00/);
  assert.equal(repeated.events.length, 0);
});

test("formats fare notifications as the requested compact four-line notice", () => {
  const message = formatTigerairPromotionMessage({
    name: "冬季航班開賣第 3 波",
    description: "日本與韓國指定航線 TWD 1,299 起",
    saleStartAt: "2026-07-13T07:00:00.000Z",
    saleEndAt: "2026-07-13T15:59:00.000Z",
    travelStartAt: "2026-10-24T16:00:00.000Z",
    travelEndAt: "2027-03-27T15:59:00.000Z",
  });

  assert.equal(message, [
    "活動：冬季航班開賣第 3 波",
    "銷售：2026/7/13 15:00–23:59",
    "旅遊期間：2026/10/25～2027/3/27",
    "票價／航線：TWD 1,299 起／活動指定航線",
  ].join("\n"));
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
