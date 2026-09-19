"""Регрес-тест на "низьку" знахідку повторного аудиту Магазин/POS: мертві
legacy-ендпоінти /shop/counts і /shop/stock-in видалені (0 звернень з
фронтенду, зайва непотрібна атакована поверхня). /other-products НЕ входив
у цю знахідку і має лишитись робочим.
"""


def _registered_paths():
    from backend.main import app
    return {r.path for r in app.routes if hasattr(r, "path")}


def test_shop_counts_endpoint_removed():
    paths = _registered_paths()
    assert "/api/v1/shop/counts" not in paths
    assert "/api/v1/shop/counts/{count_id}" not in paths


def test_shop_stock_in_endpoint_removed():
    paths = _registered_paths()
    assert "/api/v1/shop/stock-in" not in paths
    assert "/api/v1/shop/stock-in/{stock_in_id}" not in paths


def test_shop_other_products_still_works(app_client, admin_token):
    """/other-products НЕ входив у знахідку — має лишитись робочим."""
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.get("/api/v1/shop/other-products", headers=headers)
    assert resp.status_code == 200
