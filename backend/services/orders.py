"""Сервіс замовлень: копіювання, агрегація для випічки."""

from typing import List, Optional
from sqlalchemy.orm import Session
from backend.models.orders import Order


def copy_orders(
    db: Session,
    source_date: str,
    target_date: str,
    client_ids: Optional[List[int]] = None,
) -> int:
    """
    Копіює замовлення з source_date на target_date.
    Якщо client_ids=None — копіює всіх клієнтів.
    Повертає кількість створених замовлень.
    """
    query = db.query(Order).filter(Order.order_date == source_date)
    if client_ids:
        query = query.filter(Order.client_id.in_(client_ids))

    source_orders = query.all()
    created = 0

    for src in source_orders:
        # Перевіряємо чи вже є замовлення на цю дату
        exists = db.query(Order).filter(
            Order.client_id == src.client_id,
            Order.product_id == src.product_id,
            Order.order_date == target_date,
        ).first()

        if exists:
            continue

        new_order = Order(
            client_id=src.client_id,
            product_id=src.product_id,
            qty=src.qty,
            order_date=target_date,
            source=src.source,
            # Обмін не копіюємо — це одноразова операція
        )
        db.add(new_order)
        created += 1

    db.commit()
    return created


def aggregate_for_baking(db: Session, date: str) -> List[dict]:
    """
    Агрегує підтверджені замовлення по продуктах для завдання пекарям.
    """
    from sqlalchemy import func
    rows = (
        db.query(Order.product_id, func.sum(Order.qty).label("total_qty"))
        .filter(
            Order.order_date == date,
            # Тільки звичайні замовлення клієнтів (не надлишки і не переміщення)
            Order.origin_id.is_(None),
            # Виключаємо bot-замовлення які ще не підтверджені оператором
            ~((Order.source == "bot") & (Order.bot_status == "pending")),
        )
        .group_by(Order.product_id)
        .all()
    )
    return [{"product_id": r.product_id, "ordered_qty": r.total_qty} for r in rows]


def aggregate_for_baking_from_invoices(db: Session, date: str) -> List[dict]:
    """
    Агрегує кількості з накладних КЛІЄНТІВ і ВЛАСНИХ МАГАЗИНІВ по продуктах для завдання
    пекарям (новий цикл: випічка рахується від накладних, а не від замовлень — частину
    накладних оператор уже міг скоригувати у Маршрутах).

    Магазин входить у «Замовлено» (як до v1.3.0): під час випічки його накладна — чернетка
    (база замовлень магазину; надлишки доливаються лише при «Закрити накладну магазину»),
    тож недопечене можна знімати з магазину, а надлишок — рахувати від клієнти+магазин.
    Системні клієнти (writeoff/ration/underbaked) у деманд НЕ входять.
    Бере не скасовані, не коригуючі накладні, без рядків обміну (is_exchange).
    """
    from sqlalchemy import func
    from backend.models.invoices import Invoice, InvoiceLine
    from backend.models.references import Client

    rows = (
        db.query(InvoiceLine.product_id, func.sum(InvoiceLine.qty).label("total_qty"))
        .join(Invoice, Invoice.id == InvoiceLine.invoice_id)
        .join(Client, Client.id == Invoice.client_id)
        .filter(
            Invoice.invoice_date == date,
            Invoice.status != "cancelled",
            Invoice.corrective_for_id.is_(None),
            InvoiceLine.line_kind != "exchange",
            (Client.client_kind == "customer")
            | (Client.client_kind == "shop")
            | (Client.is_own_shop == 1),
        )
        .group_by(InvoiceLine.product_id)
        .all()
    )
    return [{"product_id": r.product_id, "ordered_qty": float(r.total_qty or 0)} for r in rows]
