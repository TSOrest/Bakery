"""Дашборд для власника — агрегована read-only статистика."""

from datetime import date, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.database import get_db
from backend.models.orders import Order
from backend.models.baking import BakingTask
from backend.models.finances import Finance
from backend.models.references import Client, Product
from backend.models.pricing import Price
from backend.services.finance import get_all_balances, get_summary

router = APIRouter(prefix="/dashboard", tags=["Дашборд"])


@router.get("/")
def get_dashboard(db: Session = Depends(get_db)):
    """Повна зведена статистика для дашборду власника."""
    today     = date.today().isoformat()
    week_ago  = (date.today() - timedelta(days=7)).isoformat()
    month_ago = (date.today() - timedelta(days=30)).isoformat()

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
        .filter(Order.order_date == today, Order.status != 'closed')
        .all()
    )
    orders_client_count = len(set(o.client_id for o in orders_today))
    orders_total_qty    = sum(o.qty for o in orders_today)

    # ── Замовлення за тиждень ─────────────────────────────────────────────────
    orders_week = (
        db.query(func.count(Order.id).label("cnt"), func.sum(Order.qty).label("qty"))
        .filter(Order.order_date >= week_ago, Order.status != 'closed')
        .first()
    )

    # ── Випічка сьогодні ──────────────────────────────────────────────────────
    baking_today = db.query(BakingTask).filter(BakingTask.task_date == today).all()
    baking_ordered  = sum(t.ordered_qty for t in baking_today)
    baking_baked    = sum(t.baked_qty for t in baking_today)
    baking_products = len(baking_today)

    # ── Надходження за тиждень ────────────────────────────────────────────────
    payments_week = (
        db.query(func.sum(Finance.amount))
        .filter(
            Finance.finance_date >= week_ago,
            Finance.finance_type == 'payment',
            Finance.sign == 1,
        )
        .scalar() or 0.0
    )

    # ── Надходження за місяць ─────────────────────────────────────────────────
    payments_month = (
        db.query(func.sum(Finance.amount))
        .filter(
            Finance.finance_date >= month_ago,
            Finance.finance_type == 'payment',
            Finance.sign == 1,
        )
        .scalar() or 0.0
    )

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

        # Замовлення
        "orders": {
            "today_clients": orders_client_count,
            "today_qty":     orders_total_qty,
            "week_count":    orders_week.cnt or 0,
            "week_qty":      float(orders_week.qty or 0),
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
