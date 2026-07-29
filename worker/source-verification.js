const SOURCE_REGISTRY = Object.freeze({
  apple: {
    label: "Apple 台灣官方整修品",
    allowedHosts: ["www.apple.com"],
    method: "官方 HTML＋確定性解析",
    matchesUrl(url) {
      return url.pathname.replace(/\/+$/, "") ===
        "/tw/shop/refurbished/mac";
    },
  },
  costco: {
    label: "Costco 台灣官方網站",
    allowedHosts: ["www.costco.com.tw"],
    method: "官方商品 API＋HTML 備援",
    matchesUrl(url) {
      const path = url.pathname.replace(/\/+$/, "");
      if (
        path ===
        "/Digital-Mobile/Laptops-Computers/Desktops-Computers/c/20101"
      ) {
        return true;
      }
      return (
        path === "/rest/v2/taiwan/products/search" &&
        (url.searchParams.get("query") ?? "").includes(
          "category:20101",
        )
      );
    },
  },
  pchome: {
    label: "PChome 24h 官方網站",
    allowedHosts: ["24h.pchome.com.tw"],
    method: "官方搜尋頁 HTML＋確定性解析",
    matchesUrl(url) {
      return (
        url.pathname.replace(/\/+$/, "") === "/search" &&
        (url.searchParams.get("q") ?? "").toLowerCase() ===
          "mac mini m4"
      );
    },
  },
  coupang: {
    label: "酷澎台灣官方網站",
    allowedHosts: ["www.tw.coupang.com"],
    method: "官方公開頁＋Browser Run",
    matchesUrl(url) {
      return (
        url.pathname.replace(/\/+$/, "") === "/np/search" &&
        (url.searchParams.get("q") ?? "").toLowerCase() ===
          "mac mini m4"
      );
    },
  },
  sony: {
    label: "酷澎台灣官方網站",
    allowedHosts: ["www.tw.coupang.com"],
    method: "官方公開頁＋Browser Run",
    matchesUrl(url) {
      return (
        url.pathname.replace(/\/+$/, "") === "/np/search" &&
        (url.searchParams.get("q") ?? "").toLowerCase() ===
          "wh-1000xm6"
      );
    },
  },
  airpods: {
    label: "酷澎台灣官方網站",
    allowedHosts: ["www.tw.coupang.com"],
    method: "官方公開頁＋Browser Run",
    matchesUrl(url) {
      return (
        url.pathname.replace(/\/+$/, "") === "/np/search" &&
        (url.searchParams.get("q") ?? "").toLowerCase() ===
          "airpods pro 3"
      );
    },
  },
  tigerair: {
    label: "台灣虎航官方網站",
    allowedHosts: ["www.tigerairtw.com"],
    method: "官方首頁 Browser Run＋官方活動頁二次驗證",
    matchesUrl(url) {
      return url.pathname.replace(/\/+$/, "").toLowerCase() ===
        "/zh-tw/index";
    },
  },
  chatgptPromo: {
    label: "GitHub 公開專案（社群情報）",
    allowedHosts: ["github.com"],
    method: "GitHub 公開 JSON 清單＋確定性解析；不執行掃描器",
    matchesUrl(url) {
      return url.pathname.replace(/\/+$/, "").toLowerCase() ===
        "/juk1-gh/gpt-promo-scanner";
    },
  },
  doctorOfCredit: {
    label: "Doctor of Credit 公開文章（第三方）",
    allowedHosts: ["www.doctorofcredit.com"],
    method: "公開 WordPress API＋確定性解析",
    matchesUrl(url) {
      return `${url.pathname.replace(/\/+$/, "")}/`.toLowerCase() ===
        "/chatgpt-get-two-business-seats-for-price-of-one-with-promo-code-infoseekaius-free-with-amex/";
    },
  },
});

export function verifiedSource(source) {
  const item = SOURCE_REGISTRY[source];
  if (!item) {
    throw new Error(`未註冊的資料來源：${source}`);
  }
  return item;
}

export function assertVerifiedSourceUrl(source, value) {
  const item = verifiedSource(source);
  let url;
  try {
    url = new URL(String(value ?? ""));
  } catch {
    throw new Error(`${item.label} 回傳無效網址`);
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    url.protocol !== "https:" ||
    !item.allowedHosts.includes(hostname)
  ) {
    throw new Error(
      `${item.label} 來源不符：${hostname || "unknown"}`,
    );
  }
  if (!item.matchesUrl(url)) {
    throw new Error(`${item.label} 頁面指紋不符`);
  }
  return url;
}

export function sourceDisclosure(source, sourceUrl, verifiedAt) {
  const item = verifiedSource(source);
  const url = assertVerifiedSourceUrl(source, sourceUrl);
  return [
    `資料來源：${item.label}`,
    `原始網址：${url.href}`,
    `擷取方式：${item.method}`,
    `驗證時間：${verifiedAt}`,
  ].join("\n");
}

export function formatVerifiedSources() {
  const rows = [];
  const seen = new Set();
  for (const item of Object.values(SOURCE_REGISTRY)) {
    const signature = `${item.label}|${item.method}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    rows.push(`• ${item.label}\n  ${item.method}`);
  }
  return [
    "🔐 已驗證資料來源",
    "",
    ...rows,
    "",
    "搜尋結果與相似活動頁只能用於發現，不能直接觸發正式通知。",
    "新來源必須核對官方網址與目標內容後才會加入。",
  ].join("\n");
}
