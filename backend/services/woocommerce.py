import math
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx


def _base_wp_url(wc_url: str) -> str:
    marker = "/wp-json/wc/"
    if marker in wc_url:
        return wc_url.split(marker, 1)[0].rstrip("/")

    parsed = urlsplit(wc_url)
    path = parsed.path.rstrip("/")
    if path.endswith("/wp-json"):
        path = path[: -len("/wp-json")]
    return urlunsplit((parsed.scheme, parsed.netloc, path, parsed.query, parsed.fragment)).rstrip("/")


class WooCommerceService:
    def __init__(self, *, wc_url: str, wc_key: str, wc_secret: str):
        if not wc_url or not wc_key or not wc_secret:
            raise ValueError("WooCommerce credentials are not configured for this tenant")
        self.wc_url = wc_url.rstrip("/")
        self.base_wp_url = _base_wp_url(self.wc_url)
        self.auth = httpx.BasicAuth(wc_key, wc_secret)

    async def _request(self, method: str, path: str = "", **kwargs):
        url = f"{self.wc_url}/{path.lstrip('/')}" if path else self.wc_url
        async with httpx.AsyncClient(timeout=60.0, auth=self.auth) as client:
            response = await client.request(method, url, **kwargs)
            response.raise_for_status()
            return response

    async def fetch_all_products(self) -> list[dict[str, Any]]:
        products: list[dict[str, Any]] = []
        page = 1

        while True:
            response = await self._request("GET", "products", params={"page": page, "per_page": 100})
            page_items = response.json()
            if not page_items:
                break
            products.extend(page_items)
            total_pages = int(response.headers.get("X-WP-TotalPages", page))
            if page >= total_pages:
                break
            page += 1

        return products

    async def list_products(self, page: int, search: str | None):
        params = {"page": page, "per_page": 50}
        if search:
            params["search"] = search

        response = await self._request("GET", "products", params=params)
        items = response.json()
        total = int(response.headers.get("X-WP-Total", len(items)))
        total_pages = int(response.headers.get("X-WP-TotalPages", 1))

        if search and not items:
            sku_response = await self._request("GET", "products", params={"sku": search, "per_page": 50})
            items = sku_response.json()
            total = int(sku_response.headers.get("X-WP-Total", len(items)))
            total_pages = int(sku_response.headers.get("X-WP-TotalPages", 1))

        return {
            "items": items,
            "page": page,
            "page_size": 50,
            "total": total,
            "total_pages": total_pages or max(1, math.ceil(max(total, 1) / 50)),
        }

    async def get_product(self, product_id: int):
        return (await self._request("GET", f"products/{product_id}")).json()

    async def create_product(self, payload: dict[str, Any]):
        return (await self._request("POST", "products", json=payload)).json()

    async def update_product(self, product_id: int, payload: dict[str, Any]):
        return (await self._request("PUT", f"products/{product_id}", json=payload)).json()

    async def delete_product(self, product_id: int, force: bool = False):
        return (await self._request("DELETE", f"products/{product_id}", params={"force": str(force).lower()})).json()

    async def batch_update(self, updates: list[dict[str, Any]]):
        return (await self._request("POST", "products/batch", json={"update": updates})).json()

    async def get_products_by_ids(self, product_ids: list[int]) -> dict[int, dict[str, Any]]:
        if not product_ids:
            return {}

        response = await self._request(
            "GET",
            "products",
            params={"include": ",".join(str(product_id) for product_id in product_ids), "per_page": 100},
        )
        return {int(item["id"]): item for item in response.json()}

    async def get_products_by_skus(self, skus: list[str]) -> dict[str, dict[str, Any]]:
        found: dict[str, dict[str, Any]] = {}
        unique_skus = [sku for sku in dict.fromkeys(skus) if sku]

        for start in range(0, len(unique_skus), 100):
            chunk = unique_skus[start : start + 100]
            response = await self._request("GET", "products", params={"sku": ",".join(chunk), "per_page": 100})
            for item in response.json():
                sku = item.get("sku")
                if sku:
                    found[sku] = item

        return found

    async def fetch_all_categories(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        page = 1
        while True:
            response = await self._request("GET", "products/categories", params={"per_page": 100, "page": page})
            page_items = response.json()
            if not page_items:
                break
            items.extend(page_items)
            total_pages = int(response.headers.get("X-WP-TotalPages", page))
            if page >= total_pages:
                break
            page += 1
        return items

    async def list_categories(self):
        return (await self._request("GET", "products/categories", params={"per_page": 100})).json()

    async def list_tags(self):
        return (await self._request("GET", "products/tags", params={"per_page": 100})).json()

    async def list_attributes(self):
        return (await self._request("GET", "products/attributes", params={"per_page": 100})).json()

    async def list_attribute_terms(self, attribute_id: int):
        return (await self._request("GET", f"products/attributes/{attribute_id}/terms", params={"per_page": 100})).json()

    async def list_variations(self, product_id: int):
        return (await self._request("GET", f"products/{product_id}/variations", params={"per_page": 100})).json()

    async def create_variation(self, product_id: int, payload: dict[str, Any]):
        return (await self._request("POST", f"products/{product_id}/variations", json=payload)).json()

    async def update_variation(self, product_id: int, variation_id: int, payload: dict[str, Any]):
        return (await self._request("PUT", f"products/{product_id}/variations/{variation_id}", json=payload)).json()

    async def delete_variation(self, product_id: int, variation_id: int, force: bool = True):
        return (
            await self._request(
                "DELETE",
                f"products/{product_id}/variations/{variation_id}",
                params={"force": str(force).lower()},
            )
        ).json()

    async def fetch_all_wp_media(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        page = 1

        async with httpx.AsyncClient(timeout=60.0, auth=self.auth) as client:
            while True:
                response = await client.get(
                    f"{self.base_wp_url}/wp-json/wp/v2/media",
                    params={"media_type": "image", "per_page": 100, "page": page},
                )
                response.raise_for_status()
                page_items = response.json()
                if not page_items:
                    break
                items.extend(page_items)
                total_pages = int(response.headers.get("X-WP-TotalPages", page))
                if page >= total_pages:
                    break
                page += 1

        return items
