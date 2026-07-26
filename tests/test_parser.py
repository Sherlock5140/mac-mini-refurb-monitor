import json
import unittest

from monitor.parser import ParseError, parse_products


def product_html(
    *,
    name="Mac mini Apple M4 晶片配備 10 核心 CPU 與 10 核心 GPU (整修品)",
    description="16GB 統一記憶體 256GB SSD",
    sku="FTESTTA/A",
    price=17000,
):
    data = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": name,
        "url": f"https://www.apple.com/tw/shop/product/{sku.lower()}",
        "description": description,
        "offers": [
            {
                "@type": "Offer",
                "priceCurrency": "TWD",
                "price": price,
                "sku": sku,
            }
        ],
    }
    return (
        '<html><script type="application/ld+json">'
        + json.dumps(data, ensure_ascii=False)
        + "</script></html>"
    )


class ParserTests(unittest.TestCase):
    def test_accepts_standard_m4_256gb(self):
        products = parse_products(product_html())
        self.assertEqual(len(products), 1)
        self.assertEqual(products[0].storage_gb, 256)
        self.assertEqual(products[0].memory_gb, 16)

    def test_accepts_standard_m4_512gb_with_nbsp(self):
        html = product_html(
            name="Mac\u00a0mini Apple\u00a0M4 晶片配備 10 核心 CPU (整修品)",
            description="24GB\u00a0統一記憶體512GB\u00a0SSD",
        )
        products = parse_products(html)
        self.assertEqual(products[0].storage_gb, 512)

    def test_excludes_m4_pro(self):
        html = product_html(
            name="Mac mini Apple M4 Pro 晶片配備 12 核心 CPU (整修品)"
        )
        self.assertEqual(parse_products(html), [])

    def test_excludes_m4_max(self):
        html = product_html(
            name="Mac mini Apple M4 Max 晶片配備 14 核心 CPU (整修品)"
        )
        self.assertEqual(parse_products(html), [])

    def test_excludes_other_storage(self):
        self.assertEqual(
            parse_products(product_html(description="16GB 統一記憶體 1TB SSD")),
            [],
        )

    def test_excludes_imac(self):
        html = product_html(
            name="24 吋 iMac Apple M4 晶片 (整修品)",
        )
        self.assertEqual(parse_products(html), [])

    def test_zero_matching_products_is_valid(self):
        html = product_html(name="MacBook Pro Apple M4 Pro 晶片 (整修品)")
        self.assertEqual(parse_products(html), [])

    def test_missing_product_structure_is_error(self):
        with self.assertRaises(ParseError):
            parse_products("<html><body>temporary block page</body></html>")


if __name__ == "__main__":
    unittest.main()
