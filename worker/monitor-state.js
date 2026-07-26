function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function emptyMonitorState() {
  return {
    version: 1,
    initialized: false,
    products: {},
    consecutiveErrors: 0,
    lastHeartbeatDate: null,
    lastRunAt: null,
    lastSuccessAt: null,
    lastError: null,
  };
}

function displayProduct(product) {
  const memory = product.memoryGb
    ? `、${product.memoryGb}GB 記憶體`
    : "";
  const details = product.details ??
    `${product.storageGb}GB SSD${memory}`;
  return [
    product.name,
    details,
    `NT$${product.priceTwd.toLocaleString("en-US")}`,
  ].join("\n");
}

function event(kind, title, product, extra = "") {
  return {
    kind,
    title,
    message: `${displayProduct(product)}${extra}`,
    url: product.url,
  };
}

export function applyInventory(
  state,
  currentProducts,
  nowIso,
  { label = "M4 Mac mini" } = {},
) {
  const updated = clone(state);
  updated.products ??= {};
  const current = new Map(
    currentProducts.map((product) => [product.sku, clone(product)]),
  );
  const events = [];

  if (!updated.initialized) {
    for (const [sku, product] of current) {
      updated.products[sku] = {
        ...product,
        present: true,
        missingCount: 0,
        firstSeenAt: nowIso,
      };
    }
    updated.initialized = true;
    updated.consecutiveErrors = 0;
    updated.lastError = null;
    return { state: updated, events };
  }

  for (const [sku, observed] of current) {
    const stored = updated.products[sku];
    if (!stored) {
      updated.products[sku] = {
        ...observed,
        present: true,
        missingCount: 0,
        firstSeenAt: nowIso,
      };
      events.push(
        event("new", `🆕 ${label} 新上架`, observed),
      );
      continue;
    }

    const wasPresent = Boolean(stored.present);
    const previousPrice = Number(stored.priceTwd);
    Object.assign(stored, observed, {
      present: true,
      missingCount: 0,
    });

    if (!wasPresent) {
      events.push(
        event("restock", `🎉 ${label} 重新補貨`, observed),
      );
    } else if (observed.priceTwd < previousPrice) {
      const difference = previousPrice - observed.priceTwd;
      events.push(
        event(
          "price_drop",
          `💸 ${label} 降價`,
          observed,
          `\n原價 NT$${previousPrice.toLocaleString("en-US")}，降價 NT$${difference.toLocaleString("en-US")}`,
        ),
      );
    }
  }

  for (const [sku, stored] of Object.entries(updated.products)) {
    if (current.has(sku) || !stored.present) {
      continue;
    }
    stored.missingCount = Number(stored.missingCount ?? 0) + 1;
    if (stored.missingCount >= 2) {
      stored.present = false;
      events.push(
        event("removed", `⛔️ ${label} 已下架`, stored),
      );
    }
  }

  updated.consecutiveErrors = 0;
  updated.lastError = null;
  return { state: updated, events };
}

export function applyMonitorError(
  state,
  message,
  nowIso,
  { label = "Mac mini" } = {},
) {
  const updated = clone(state);
  updated.consecutiveErrors =
    Number(updated.consecutiveErrors ?? 0) + 1;
  updated.lastRunAt = nowIso;
  updated.lastError = String(message).slice(0, 500);
  const count = updated.consecutiveErrors;
  const events = [];
  if ([1, 3, 6].includes(count)) {
    events.push({
      kind: "error",
      title: `⚠️ ${label} 監控異常`,
      message: `連續錯誤 ${count} 次\n${updated.lastError}`,
      url: null,
    });
  }
  return { state: updated, events };
}

export function recoveryEvent(
  previousErrorCount,
  { label = "Mac mini", source = "Apple" } = {},
) {
  if (previousErrorCount <= 0) {
    return null;
  }
  return {
    kind: "recovered",
    title: `✅ ${label} 監控已恢復`,
    message:
      `先前連續錯誤 ${previousErrorCount} 次，` +
      `本次已成功取得並解析 ${source} 商品資料。`,
    url: null,
  };
}
