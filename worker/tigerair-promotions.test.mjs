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
  isPriorityTigerairRoute,
  isTigerairFarePromotion,
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
  assert.match(opened.events[0].message, /2026\/7\/29 10:00/);
  assert.match(opened.events[0].message, /票價／航線：/);
  assert.doesNotMatch(
    opened.events[0].message,
    /現在可前往|擷取方式|驗證時間/,
  );
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

test("prioritizes Kaohsiung-Gimpo fare offers without disabling other routes", () => {
  const priority = {
    sku: "https://www.tigerairtw.com/zh-tw/news/khh-gmp-sale",
    name: "高雄飛首爾金浦航線限時優惠",
    description: "KHH–GMP 單程未稅 TWD 1,599 起",
    details: "台灣虎航官網優惠消息",
    url: "https://www.tigerairtw.com/zh-TW/news/khh-gmp-sale",
    kind: "official-news",
    fingerprint: "khh-gmp-sale",
  };
  const wrongAirport = {
    ...priority,
    name: "高雄飛首爾仁川航線限時優惠",
    description: "KHH–ICN 單程未稅 TWD 1,599 起",
  };
  const ordinary = {
    ...priority,
    sku: "https://www.tigerairtw.com/zh-tw/news/nrt-sale",
    name: "桃園飛東京航線限時優惠",
    description: "TPE–NRT 單程未稅 TWD 1,599 起",
    url: "https://www.tigerairtw.com/zh-TW/news/nrt-sale",
    fingerprint: "nrt-sale",
  };

  assert.equal(isPriorityTigerairRoute(priority), true);
  assert.equal(isPriorityTigerairRoute(wrongAirport), false);
  assert.equal(isPriorityTigerairRoute(ordinary), false);
  assert.match(
    formatTigerairPromotionMessage(priority),
    /票價／航線：TWD 1,599 起／高雄－首爾（金浦）/,
  );

  const state = emptyMonitorState();
  state.initialized = true;
  const result = applyTigerairPromotions(
    state,
    [priority, ordinary],
    "2026-07-28T14:30:00.000Z",
  );
  assert.equal(result.events.length, 2);
  assert.match(result.events[0].title, /高雄－金浦/);
  assert.match(result.events[1].title, /虎航新優惠公告/);
});

test("consumes one backend Tigerair test request exactly once", () => {
  const item = parseTigerairPromotionDetail(
    currentPromotionHtml,
    "https://www.tigerairtw.com/zh-TW/EVENTS/2607tigeresg/",
  );
  item.present = true;
  const state = emptyMonitorState();
  state.initialized = true;
  state.products.card = {
    sku: "https://booking.tigerairtw.com/zh-tw/portal/cobrand/rakuten",
    name: "全新升級－樂虎卡",
    description: "持卡平日購票最高 85 折起",
    url: "https://booking.tigerairtw.com/zh-TW/portal/cobrand/Rakuten",
    kind: "official-offer",
    present: true,
  };
  state.products.bank = {
    sku: "https://booking.tigerairtw.com/zh-tw/portal/credit-card/test",
    name: "台新銀行專屬限定優惠",
    description: "刷信用卡享全航線最高 95 折",
    url: "https://booking.tigerairtw.com/zh-TW/portal/credit-card/test",
    kind: "official-offer",
    present: true,
  };
  state.products[item.sku] = item;
  state.products.__backend_test__ = {
    requestedAt: "2026-07-28T14:20:00.000Z",
  };

  const first = applyTigerairSaleOpenReminders(
    state,
    "2026-07-28T14:20:00.000Z",
  );
  const repeated = applyTigerairSaleOpenReminders(
    first.state,
    "2026-07-28T14:25:00.000Z",
  );

  assert.equal(first.events.length, 1);
  assert.equal(first.events[0].kind, "backend_test");
  assert.match(first.events[0].title, /虎航後端即時資料/);
  assert.match(first.events[0].message, /票價／航線：/);
  assert.doesNotMatch(
    first.events[0].message,
    /樂虎卡|台新銀行|信用卡|85 折|95 折/,
  );
  assert.equal(first.events[0].url, item.url);
  assert.equal(first.state.products.__backend_test__, undefined);
  assert.equal(repeated.events.length, 0);
});

test("rejects stale card offers from every Tigerair notification path", () => {
  const fare = parseTigerairPromotionDetail(
    currentPromotionHtml,
    "https://www.tigerairtw.com/zh-TW/EVENTS/2607tigeresg/",
  );
  const card = {
    sku: "https://booking.tigerairtw.com/zh-tw/portal/cobrand/rakuten",
    name: "樂虎卡全航線購票最高 85 折起",
    description: "持卡享優惠",
    url: "https://booking.tigerairtw.com/zh-TW/portal/cobrand/Rakuten",
    kind: "official-offer",
    fingerprint: "card",
  };
  const state = emptyMonitorState();
  state.initialized = true;
  const result = applyTigerairPromotions(
    state,
    [card, fare],
    "2026-07-28T14:30:00.000Z",
  );

  assert.equal(isTigerairFarePromotion(card), false);
  assert.equal(isTigerairFarePromotion(fare), true);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].url, fare.url);
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
