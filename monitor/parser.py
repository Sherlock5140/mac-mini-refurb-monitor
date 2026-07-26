"""Parse structured product data from the Apple Taiwan refurbished store."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from html.parser import HTMLParser
import json
import re
from typing import Any


SPACE_RE = re.compile(r"\s+")
SSD_RE = re.compile(r"(?<!\d)(\d+(?:\.\d+)?)\s*(GB|TB)\s*SSD", re.IGNORECASE)
MEMORY_RE = re.compile(r"(?<!\d)(\d+)\s*GB\s*統一記憶體", re.IGNORECASE)
STANDARD_M4_RE = re.compile(r"\bApple\s*M4\s*晶片", re.IGNORECASE)
PRO_CHIP_RE = re.compile(r"\bM4\s*(?:Pro|Max)\b", re.IGNORECASE)


class ParseError(RuntimeError):
    """Raised when the Apple page no longer contains usable product data."""


@dataclass(frozen=True)
class Product:
    product_id: str
    sku: str
    name: str
    storage_gb: int
    memory_gb: int | None
    price_twd: int
    url: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class _JsonLdParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._in_json_ld = False
        self._chunks: list[str] = []
        self.documents: list[Any] = []

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        if tag.lower() != "script":
            return
        attributes = {key.lower(): value for key, value in attrs}
        if (attributes.get("type") or "").lower() == "application/ld+json":
            self._in_json_ld = True
            self._chunks = []

    def handle_data(self, data: str) -> None:
        if self._in_json_ld:
            self._chunks.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() != "script" or not self._in_json_ld:
            return
        self._in_json_ld = False
        raw = "".join(self._chunks).strip()
        if not raw:
            return
        try:
            self.documents.append(json.loads(raw))
        except json.JSONDecodeError:
            # A malformed unrelated block must not hide otherwise valid products.
            return


def _normalize_text(value: Any) -> str:
    return SPACE_RE.sub(" ", str(value or "").replace("\u00a0", " ")).strip()


def _product_documents(documents: list[Any]) -> list[dict[str, Any]]:
    products: list[dict[str, Any]] = []

    def visit(value: Any) -> None:
        if isinstance(value, list):
            for item in value:
                visit(item)
            return
        if not isinstance(value, dict):
            return
        if value.get("@type") == "Product":
            products.append(value)
        graph = value.get("@graph")
        if graph is not None:
            visit(graph)

    visit(documents)
    return products


def _storage_gb(description: str) -> int | None:
    match = SSD_RE.search(description)
    if not match:
        return None
    value = float(match.group(1))
    if match.group(2).upper() == "TB":
        value *= 1024
    return int(value)


def _offer(product: dict[str, Any]) -> dict[str, Any]:
    offers = product.get("offers")
    if isinstance(offers, list):
        return next((item for item in offers if isinstance(item, dict)), {})
    return offers if isinstance(offers, dict) else {}


def _target_product(product: dict[str, Any]) -> Product | None:
    name = _normalize_text(product.get("name"))
    description = _normalize_text(product.get("description"))
    if "mac mini" not in name.lower():
        return None
    if not STANDARD_M4_RE.search(name) or PRO_CHIP_RE.search(name):
        return None

    storage_gb = _storage_gb(description)
    if storage_gb not in {256, 512}:
        return None

    offer = _offer(product)
    sku = _normalize_text(offer.get("sku") or product.get("sku")).upper()
    url = _normalize_text(product.get("url") or product.get("mainEntityOfPage"))
    price = offer.get("price")
    if not sku or not url or price is None:
        return None

    memory_match = MEMORY_RE.search(description)
    product_id = sku.replace("/", "-")
    return Product(
        product_id=product_id,
        sku=sku,
        name=name,
        storage_gb=storage_gb,
        memory_gb=int(memory_match.group(1)) if memory_match else None,
        price_twd=int(float(price)),
        url=url,
    )


def parse_products(html: str) -> list[Product]:
    """Return matching M4 Mac minis, raising if the page structure is invalid."""
    parser = _JsonLdParser()
    parser.feed(html)
    all_products = _product_documents(parser.documents)
    if not all_products:
        raise ParseError(
            "Apple 頁面沒有任何 JSON-LD Product；可能是網路攔截或頁面結構已改變"
        )

    matches: dict[str, Product] = {}
    for raw_product in all_products:
        product = _target_product(raw_product)
        if product is not None:
            matches[product.product_id] = product
    return sorted(matches.values(), key=lambda item: item.product_id)
