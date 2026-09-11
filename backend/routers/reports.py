"""Звітні JSON-ендпоінти (баланси виробів тощо) — для інтерактивних дашбордів,
на відміну від /print/* які повертають готовий HTML для друку."""

from typing import Dict, Tuple
from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.orders import Order
from backend.models.references import Client, Product, Category
from backend.models.invoices import Invoice, InvoiceLine
from backend.models.shop import ShopReconciliationLine, ShopDisposalLine
from backend.routers.auth import require_user
from backend.routers.print_views import _compute_section1_data
from backend.schemas.reports import (
    ProductBalancesOut, ProductBalanceCategory, ProductBalanceProduct, ProductBalanceClientRow,
)

router = APIRouter(prefix="/reports", tags=["Звіти"])

# Сентінел-ідентифікатори для рядків списання/пайку/іншого магазину, що не
# прив'язані до конкретного клієнта (disposal_type != 'client').
_SHOP_SENTINEL = {"writeoff": -1, "ration": -2, "other": -3}
_SHOP_LABEL = {"writeoff": "Списання (магазин)", "ration": "Пайок (магазин)", "other": "Інше (магазин)"}


@router.get("/product-balances", response_model=ProductBalancesOut)
def product_balances(date: str, db: Session = Depends(get_db), _=Depends(require_user)):
    """Баланси виробів за день.

    Замовлено/Спечено/Обмін/Магазин — 1:1 з Секцією 1 денного звіту
    (через спільну _compute_section1_data, щоб цифри ніколи не розійшлись).
    Додатково: деталізація по накладних/клієнтах, списання/пайок/інше
    (за собівартістю), і розбіжність Спечено vs задокументований рух.
    """
    section1 = _compute_section1_data(db, date)

    # ── Замовлено по клієнтах: той самий фільтр що й "Замовлено" в section1,
    # але з розбивкою по client_id (для деталізації рівня 3) ──────────────
    SYSTEM_KINDS = ("shop", "writeoff", "ration", "underbaked")
    ordered_client_rows = (
        db.query(Order.product_id, Order.client_id, func.sum(Order.qty).label("qty"))
        .join(Client, Client.id == Order.client_id)
        .filter(
            Order.order_date == date,
            Order.origin_id.is_(None),
            Order.parent_order_id.is_(None),
            Order.exchange_type == "none",
            Order.price_override.is_(None),
            Client.client_kind.notin_(SYSTEM_KINDS),
        )
        .group_by(Order.product_id, Order.client_id)
        .all()
    )
    ordered_by_client: Dict[int, Dict[int, float]] = {}
    for r in ordered_client_rows:
        ordered_by_client.setdefault(r.product_id, {})[r.client_id] = float(r.qty or 0)

    # ── В накладних: qty+сума по (product, client, line_kind) ──────────────
    inv_rows = (
        db.query(
            InvoiceLine.product_id,
            Invoice.client_id,
            InvoiceLine.line_kind,
            func.sum(InvoiceLine.qty).label("qty"),
            func.sum(InvoiceLine.sum).label("sum"),
        )
        .join(Invoice, Invoice.id == InvoiceLine.invoice_id)
        .filter(
            Invoice.invoice_date == date,
            Invoice.status != "cancelled",
            Invoice.corrective_for_id.is_(None),
        )
        .group_by(InvoiceLine.product_id, Invoice.client_id, InvoiceLine.line_kind)
        .all()
    )
    inv_agg: Dict[int, Dict[Tuple[int, str], dict]] = {}
    for r in inv_rows:
        inv_agg.setdefault(r.product_id, {})[(r.client_id, r.line_kind)] = {
            "qty": float(r.qty or 0), "sum": float(r.sum or 0),
        }

    # ── Списання/пайок (фабрика): Order origin_id=0, системний клієнт ──────
    factory_rows = (
        db.query(Order.product_id, Order.client_id, Client.client_kind,
                 func.sum(Order.qty).label("qty"))
        .join(Client, Client.id == Order.client_id)
        .filter(
            Order.order_date == date,
            Order.origin_id == 0,
            Client.client_kind.in_(["writeoff", "ration"]),
        )
        .group_by(Order.product_id, Order.client_id, Client.client_kind)
        .all()
    )
    factory_agg: Dict[int, Dict[int, dict]] = {}
    for r in factory_rows:
        factory_agg.setdefault(r.product_id, {})[r.client_id] = {
            "kind": r.client_kind, "qty": float(r.qty or 0),
        }

    # ── Списання/пайок/інше (магазин): за датою партії ──────────────────────
    shop_raw = (
        db.query(ShopReconciliationLine.product_id, ShopDisposalLine.disposal_type,
                 ShopDisposalLine.client_id, ShopDisposalLine.price, ShopDisposalLine.qty)
        .join(ShopReconciliationLine, ShopReconciliationLine.id == ShopDisposalLine.reconciliation_line_id)
        .filter(ShopReconciliationLine.batch_date == date)
        .all()
    )
    # pid -> (bucket, client_id|None) -> {"qty", "priced_value", "cost_qty"}
    shop_agg: Dict[int, Dict[Tuple[str, object], dict]] = {}
    for row in shop_raw:
        bucket = {"writeoff": "writeoff", "ration": "ration"}.get(row.disposal_type, "other")
        key = (bucket, row.client_id)
        b = shop_agg.setdefault(row.product_id, {}).setdefault(
            key, {"qty": 0.0, "priced_value": 0.0, "cost_qty": 0.0}
        )
        q = float(row.qty or 0)
        b["qty"] += q
        if row.disposal_type == "sale" and row.price is not None:
            b["priced_value"] += q * float(row.price)
        else:
            b["cost_qty"] += q

    # ── Довідники: усі продукти/клієнти/категорії задіяні у будь-якому джерелі ──
    all_pids = (
        {pid for cat in section1.values() for p in cat["products"] for pid in [p["product_id"]]}
        | set(inv_agg) | set(factory_agg) | set(shop_agg)
    )
    products_map: Dict[int, Product] = (
        {p.id: p for p in db.query(Product).filter(Product.id.in_(all_pids)).all()} if all_pids else {}
    )
    extra_cat_ids = {p.category_id for p in products_map.values() if p.category_id} - set(
        cid for cid in section1
    )
    categories_map: Dict[int, Category] = dict(
        (c.id, c) for c in db.query(Category).filter(
            Category.id.in_(set(section1) | extra_cat_ids)
        ).all()
    ) if (section1 or extra_cat_ids) else {}

    real_client_ids = (
        {cid for pid in ordered_by_client for cid in ordered_by_client[pid]}
        | {cid for pid in inv_agg for (cid, _lk) in inv_agg[pid]}
        | {cid for pid in factory_agg for cid in factory_agg[pid]}
        | {cid for pid in shop_agg for (_b, cid) in shop_agg[pid] if cid is not None}
    )
    client_map: Dict[int, Client] = (
        {c.id: c for c in db.query(Client).filter(Client.id.in_(real_client_ids)).all()}
        if real_client_ids else {}
    )

    def client_display(cid: int) -> Tuple[str, str]:
        c = client_map.get(cid)
        if not c:
            return ("?", "customer")
        return (c.short_name or c.full_name, c.client_kind or "customer")

    def build_product(pid: int, base: dict) -> ProductBalanceProduct:
        product = products_map.get(pid)
        cost = (product.cost_per_unit or 0.0) if product else 0.0

        # Один рядок на клієнта — зливаємо Замовлено/Накладні/Списання-Пайок-Інше
        # в один запис, щоб оператор бачив повну картину по клієнту одразу.
        rows: Dict[int, dict] = {}

        def get_row(cid: int, name: str, kind: str) -> dict:
            return rows.setdefault(cid, {
                "client_id": cid, "client_name": name, "client_kind": kind,
                "ordered_qty": 0.0, "invoiced_qty": 0.0, "invoiced_sum": 0.0,
                "other_qty": 0.0, "other_sum": 0.0, "tags": [],
            })

        for cid, oqty in ordered_by_client.get(pid, {}).items():
            name, kind = client_display(cid)
            get_row(cid, name, kind)["ordered_qty"] += oqty

        invoiced_qty = invoiced_sum = 0.0
        for (cid, line_kind), v in inv_agg.get(pid, {}).items():
            name, kind = client_display(cid)
            r = get_row(cid, name, kind)
            r["invoiced_qty"] += v["qty"]; r["invoiced_sum"] += v["sum"]
            if line_kind and line_kind != "normal" and line_kind not in r["tags"]:
                r["tags"].append(line_kind)
            invoiced_qty += v["qty"]; invoiced_sum += v["sum"]

        writeoff_qty = writeoff_sum = ration_qty = ration_sum = 0.0
        for cid, v in factory_agg.get(pid, {}).items():
            name, kind = client_display(cid)
            row_sum = v["qty"] * cost
            source = "writeoff" if v["kind"] == "writeoff" else "ration"
            r = get_row(cid, name, kind)
            r["other_qty"] += v["qty"]; r["other_sum"] += row_sum
            if source not in r["tags"]: r["tags"].append(source)
            if source == "writeoff":
                writeoff_qty += v["qty"]; writeoff_sum += row_sum
            else:
                ration_qty += v["qty"]; ration_sum += row_sum

        other_qty = other_sum = 0.0
        for (bucket, cid), v in shop_agg.get(pid, {}).items():
            row_sum = v["priced_value"] + v["cost_qty"] * cost
            if cid is not None:
                name, kind = client_display(cid)
            else:
                name, kind = _SHOP_LABEL[bucket], "system"
                cid = _SHOP_SENTINEL[bucket]
            r = get_row(cid, name, kind)
            r["other_qty"] += v["qty"]; r["other_sum"] += row_sum
            if bucket not in r["tags"]: r["tags"].append(bucket)
            if bucket == "writeoff":
                writeoff_qty += v["qty"]; writeoff_sum += row_sum
            elif bucket == "ration":
                ration_qty += v["qty"]; ration_sum += row_sum
            else:
                other_qty += v["qty"]; other_sum += row_sum

        clients = [ProductBalanceClientRow(**r) for r in rows.values()]
        clients.sort(key=lambda c: (c.client_kind == "system", c.client_name))

        diff_qty = None
        if base["baked_entered"]:
            diff_qty = base["baked"] - (invoiced_qty + writeoff_qty + ration_qty + other_qty)

        return ProductBalanceProduct(
            product_id=pid,
            name=base["name"],
            short_name=base.get("short_name"),
            ordered_qty=base["ordered"],
            baked_qty=base["baked"],
            baked_entered=base["baked_entered"],
            exchange_qty=base["exchange"],
            shop_qty=base["shop"],
            invoiced_qty=invoiced_qty, invoiced_sum=invoiced_sum,
            writeoff_qty=writeoff_qty, writeoff_sum=writeoff_sum,
            ration_qty=ration_qty, ration_sum=ration_sum,
            other_qty=other_qty, other_sum=other_sum,
            diff_qty=diff_qty,
            clients=clients,
        )

    # ── Продукти, що НЕ потрапили в section1 (мають рух лише поза випічкою) ──
    covered_pids = {p["product_id"] for cat in section1.values() for p in cat["products"]}
    extra_pids = all_pids - covered_pids
    extra_by_cat: Dict[int, list] = {}
    for pid in extra_pids:
        product = products_map.get(pid)
        cat_id = product.category_id if product else None
        if not cat_id or cat_id not in categories_map:
            continue
        extra_by_cat.setdefault(cat_id, []).append({
            "product_id": pid, "name": product.name, "short_name": product.short_name,
            "ordered": 0.0, "baked": 0.0, "baked_entered": False,
            "exchange": 0.0, "shop": 0.0,
        })

    categories: list[ProductBalanceCategory] = []
    all_cat_ids = set(section1) | set(extra_by_cat)
    for cat_id in sorted(all_cat_ids, key=lambda cid: categories_map[cid].sort_order if cid in categories_map else 999):
        base_products = section1.get(cat_id, {}).get("products", [])
        products = [build_product(p["product_id"], p) for p in base_products]
        products += [build_product(p["product_id"], p) for p in extra_by_cat.get(cat_id, [])]

        cat_name = (
            section1[cat_id]["name"] if cat_id in section1
            else categories_map[cat_id].name
        )
        entered_flags = [p.baked_entered for p in products]
        baked_entered = bool(products) and all(entered_flags)
        diff_qty = sum(p.diff_qty for p in products) if baked_entered else None

        categories.append(ProductBalanceCategory(
            category_id=cat_id,
            category_name=cat_name,
            ordered_qty=sum(p.ordered_qty for p in products),
            baked_qty=sum(p.baked_qty for p in products),
            baked_entered=baked_entered,
            exchange_qty=sum(p.exchange_qty for p in products),
            shop_qty=sum(p.shop_qty for p in products),
            invoiced_qty=sum(p.invoiced_qty for p in products),
            invoiced_sum=sum(p.invoiced_sum for p in products),
            writeoff_qty=sum(p.writeoff_qty for p in products),
            writeoff_sum=sum(p.writeoff_sum for p in products),
            ration_qty=sum(p.ration_qty for p in products),
            ration_sum=sum(p.ration_sum for p in products),
            other_qty=sum(p.other_qty for p in products),
            other_sum=sum(p.other_sum for p in products),
            diff_qty=diff_qty,
            products=products,
        ))

    return ProductBalancesOut(date=date, categories=categories)
