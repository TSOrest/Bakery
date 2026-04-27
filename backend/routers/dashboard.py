"""Дашборд для власника — агрегована read-only статистика."""

from calendar import monthrange
from datetime import date, timedelta
from typing import Optional
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.database import get_db
from backend.models.orders import Order
from backend.models.baking import BakingTask
from backend.models.finances import Finance, FinanceArticle
from backend.models.references import Client, Product
from backend.models.pricing import Price
from backend.models.shop import ShopSale, ShopReconciliation, ShopReconciliationLine
from backend.services.finance import get_all_balances, get_summary

router = APIRouter(prefix="/dashboard", tags=["Дашборд"])


@router.get("/")
def get_dashboard(date_param: Optional[str] = None, db: Session = Depends(get_db)):
    """Повна зведена статистика для дашборду власника."""
    today_d   = date.fromisoformat(date_param) if date_param else date.today()
    today     = today_d.isoformat()
    week_ago  = (today_d - timedelta(days=7)).isoformat()
    month_ago = (today_d - timedelta(days=30)).isoformat()

    # ── Фінанси ──────────────────────────────────────────────────────────────
    fin_summary = get_summary(db)

    # ── Топ-5 боржників ───────────────────────────────────────────────────────
    all_balances = get_all_balances(db)
    top_debtors = sorted(
        [b for b in all_balances if b.balance < 0],
        key=lambda b: b.balance
    )[:5]

    # ── Замовлення сьогодні ───────────────────────────────────────────────────
    orders_today = (
        db.query(Order)
        .filter(Order.order_date == today, Order.qty > 0)
        .all()
    )
    orders_client_count = len(set(o.client_id for o in orders_today))
    orders_total_qty    = sum(o.qty for o in orders_today)

    # ── Замовлення за тиждень ─────────────────────────────────────────────────
    orders_week = (
        db.query(func.count(Order.id).label("cnt"), func.sum(Order.qty).label("qty"))
        .filter(Order.order_date >= week_ago)
        .first()
    )

    # ── Випічка сьогодні ──────────────────────────────────────────────────────
    baking_today = db.query(BakingTask).filter(BakingTask.task_date == today).all()
    baking_ordered  = sum(t.ordered_qty or 0 for t in baking_today)
    baking_baked    = sum(t.baked_qty   or 0 for t in baking_today)
    baking_products = len(baking_today)

    # ── Артикли для фільтрів (підтримка і старого finance_type і нового article_id) ──
    def _payment_filter(q):
        """Фільтр оплат: article.name LIKE '%лата%' АБО legacy finance_type='payment'."""
        payment_ids = [
            a.id for a in db.query(FinanceArticle).filter(
                FinanceArticle.name.in_(['Оплата', 'Готівка від водія', 'Внесення в касу'])
            ).all()
        ]
        from sqlalchemy import or_
        return q.filter(or_(
            Finance.article_id.in_(payment_ids) if payment_ids else False,
            Finance.finance_type == 'payment',
        ))

    def _invoice_filter(q):
        invoice_ids = [a.id for a in db.query(FinanceArticle).filter(FinanceArticle.name == 'Накладна').all()]
        from sqlalchemy import or_
        return q.filter(or_(
            Finance.article_id.in_(invoice_ids) if invoice_ids else False,
            Finance.finance_type == 'invoice',
        ))

    # ── Надходження за тиждень ────────────────────────────────────────────────
    payments_week = (
        _payment_filter(
            db.query(func.sum(Finance.amount))
            .filter(Finance.finance_date >= week_ago, Finance.sign == 1)
        ).scalar() or 0.0
    )

    # ── Надходження за місяць ─────────────────────────────────────────────────
    payments_month = (
        _payment_filter(
            db.query(func.sum(Finance.amount))
            .filter(Finance.finance_date >= month_ago, Finance.sign == 1)
        ).scalar() or 0.0
    )

    # ── Виручка сьогодні (накладні) ──────────────────────────────────────────
    revenue_today = (
        _invoice_filter(
            db.query(func.sum(Finance.amount))
            .filter(Finance.finance_date == today)
        ).scalar() or 0.0
    )

    # ── Оплати сьогодні ───────────────────────────────────────────────────────
    payments_today_rows = (
        _payment_filter(
            db.query(Finance)
            .filter(Finance.finance_date == today, Finance.sign == 1)
        ).all()
    )
    payments_today_sum   = sum(p.amount for p in payments_today_rows)
    payments_today_count = len(payments_today_rows)

    # ── Топ-5 продуктів за замовленнями сьогодні ──────────────────────────────
    top_products_rows = (
        db.query(Product.name, func.sum(Order.qty).label("total_qty"))
        .join(Product, Order.product_id == Product.id)
        .filter(Order.order_date == today, Order.qty > 0)
        .group_by(Product.id)
        .order_by(func.sum(Order.qty).desc())
        .limit(5)
        .all()
    )
    top_products = [{"name": r.name, "qty": float(r.total_qty)} for r in top_products_rows]

    # ── Середня маржа (по активних виробах з ціною і собівартістю) ───────────
    products = db.query(Product).filter(Product.is_active == 1).all()
    active_prices = (
        db.query(Price)
        .filter(
            Price.is_active == 1,
            Price.valid_from <= today,
        )
        .filter((Price.valid_to == None) | (Price.valid_to >= today))
        .order_by(Price.product_id, Price.valid_from.desc())
        .all()
    )
    price_map: dict[int, float] = {}
    for p in active_prices:
        if p.product_id not in price_map:
            price_map[p.product_id] = p.price

    margin_rows = []
    for p in products:
        cost  = p.cost_per_unit or 0
        price = price_map.get(p.id, 0)
        if price > 0 and cost > 0:
            margin_rows.append({
                "name":       p.name,
                "cost":       cost,
                "price":      price,
                "margin_grn": round(price - cost, 4),
                "margin_pct": round((price - cost) / price * 100, 2),
            })

    avg_margin_pct = (
        round(sum(r["margin_pct"] for r in margin_rows) / len(margin_rows), 1)
        if margin_rows else 0.0
    )

    return {
        "date": today,

        # Фінанси
        "finance": {
            "total_debt":         fin_summary.total_debt,
            "total_credit":       fin_summary.total_credit,
            "net_balance":        fin_summary.net_balance,
            "clients_in_debt":    fin_summary.clients_in_debt,
            "clients_with_credit": fin_summary.clients_with_credit,
            "payments_week":      round(payments_week, 2),
            "payments_month":     round(payments_month, 2),
        },

        # Топ боржники
        "top_debtors": [
            {
                "client_id":   b.client_id,
                "client_name": b.short_name or b.client_name,
                "balance":     b.balance,
            }
            for b in top_debtors
        ],

        # Виручка і оплати сьогодні
        "today": {
            "revenue":        round(revenue_today, 2),
            "payments_sum":   round(payments_today_sum, 2),
            "payments_count": payments_today_count,
        },

        # Замовлення
        "orders": {
            "today_clients": orders_client_count,
            "today_qty":     round(orders_total_qty, 2),
            "week_count":    orders_week.cnt or 0,
            "week_qty":      float(orders_week.qty or 0),
            "top_products":  top_products,
        },

        # Випічка
        "baking": {
            "products":  baking_products,
            "ordered":   baking_ordered,
            "baked":     baking_baked,
            "fulfillment_pct": (
                round(baking_baked / baking_ordered * 100, 1)
                if baking_ordered > 0 else 0.0
            ),
        },

        # Маржа
        "margin": {
            "avg_pct":        avg_margin_pct,
            "products_count": len(margin_rows),
            "top": sorted(margin_rows, key=lambda r: r["margin_pct"], reverse=True)[:5],
        },
    }


@router.get("/shop-summary/")
def get_shop_summary(date: str, db: Session = Depends(get_db)):
    """Зведення по магазину за вказану дату."""
    shop_clients = db.query(Client).filter(
        Client.client_kind == "shop"
    ).all()

    if not shop_clients:
        return {"available": False}

    shop_ids = [c.id for c in shop_clients]

    # Стаття "Накладна" — відвантаження в магазин
    invoice_art = (
        db.query(FinanceArticle).filter(FinanceArticle.name == "Накладна").first()
    )
    # Статті оплат від магазину
    payment_arts = db.query(FinanceArticle).filter(
        FinanceArticle.name.in_(["Оплата", "Оплата клієнта"])
    ).all()
    payment_art_ids = [a.id for a in payment_arts]

    # Оборот (відвантажено в магазин за день)
    turnover = 0.0
    if invoice_art:
        turnover = (
            db.query(func.sum(Finance.amount))
            .filter(
                Finance.finance_date == date,
                Finance.client_id.in_(shop_ids),
                Finance.article_id == invoice_art.id,
            )
            .scalar() or 0.0
        )

    # Передано в касу пекарні за день
    cash_to_bakery = 0.0
    if payment_art_ids:
        cash_to_bakery = (
            db.query(func.sum(Finance.amount))
            .filter(
                Finance.finance_date == date,
                Finance.client_id.in_(shop_ids),
                Finance.article_id.in_(payment_art_ids),
                Finance.sign == 1,
            )
            .scalar() or 0.0
        )

    # Накопичений баланс магазину до кінця обраної дати
    # (від'ємний = магазин має борг перед пекарнею)
    shop_balance = (
        db.query(func.sum(Finance.amount * Finance.sign))
        .filter(
            Finance.finance_date <= date,
            Finance.client_id.in_(shop_ids),
        )
        .scalar() or 0.0
    )

    # POS-продажі за день (якщо є)
    pos_sales = (
        db.query(func.sum(ShopSale.amount))
        .filter(
            ShopSale.sale_date == date,
            ShopSale.shop_client_id.in_(shop_ids),
        )
        .scalar() or 0.0
    )

    # Залишок у товарі — остання закрита звірка до обраної дати
    latest_recon = (
        db.query(ShopReconciliation)
        .filter(
            ShopReconciliation.shop_client_id.in_(shop_ids),
            ShopReconciliation.period_to <= date,
            ShopReconciliation.closed == 1,
        )
        .order_by(ShopReconciliation.period_to.desc())
        .first()
    )

    stock_value = 0.0
    stock_date: Optional[str] = None
    if latest_recon:
        v = (
            db.query(func.sum(ShopReconciliationLine.entered_balance * ShopReconciliationLine.price))
            .filter(
                ShopReconciliationLine.reconciliation_id == latest_recon.id,
                ShopReconciliationLine.entered_balance.isnot(None),
                ShopReconciliationLine.price.isnot(None),
            )
            .scalar()
        )
        stock_value = round(float(v or 0.0), 2)
        stock_date  = latest_recon.period_to

    return {
        "available":      True,
        "shop_count":     len(shop_clients),
        "turnover":       round(float(turnover), 2),
        "cash_to_bakery": round(float(cash_to_bakery), 2),
        "shop_balance":   round(float(shop_balance), 2),
        "pos_sales":      round(float(pos_sales), 2),
        "stock_value":    stock_value,
        "stock_date":     stock_date,
    }


@router.get("/calendar/")
def get_calendar(year: int, month: int, db: Session = Depends(get_db)):
    """Поденні підсумки для календаря дашборду."""
    from backend.models.finances import FinanceArticle

    _, days_in_month = monthrange(year, month)
    first_day = date(year, month, 1).isoformat()
    last_day  = date(year, month, days_in_month).isoformat()

    # Замовлення: кількість унікальних клієнтів-покупців по днях
    orders_rows = (
        db.query(
            Order.order_date,
            func.count(func.distinct(Order.client_id)).label("clients"),
        )
        .join(Client, Order.client_id == Client.id)
        .filter(
            Order.order_date >= first_day,
            Order.order_date <= last_day,
            Order.qty > 0,
            Client.client_kind == "customer",
        )
        .group_by(Order.order_date)
        .all()
    )

    # Статті фінансів: Накладна і Оплата
    invoice_article = db.query(FinanceArticle).filter(FinanceArticle.name == "Накладна").first()
    payment_article = db.query(FinanceArticle).filter(FinanceArticle.name == "Оплата").first()
    article_ids = [a.id for a in [invoice_article, payment_article] if a]

    finance_rows = (
        db.query(
            Finance.finance_date,
            Finance.article_id,
            Finance.sign,
            func.sum(Finance.amount).label("total"),
        )
        .filter(
            Finance.finance_date >= first_day,
            Finance.finance_date <= last_day,
            Finance.article_id.in_(article_ids),
        )
        .group_by(Finance.finance_date, Finance.article_id, Finance.sign)
        .all()
    ) if article_ids else []

    days: dict[str, dict] = {}

    for r in orders_rows:
        days.setdefault(r.order_date, {})["clients"] = int(r.clients or 0)

    for r in finance_rows:
        d = days.setdefault(r.finance_date, {})
        if invoice_article and r.article_id == invoice_article.id:
            d["invoices_sum"] = round(d.get("invoices_sum", 0.0) + float(r.total or 0), 2)
        elif payment_article and r.article_id == payment_article.id and r.sign == 1:
            d["payments_sum"] = round(d.get("payments_sum", 0.0) + float(r.total or 0), 2)

    return {"year": year, "month": month, "days": days}
