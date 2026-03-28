"""Сервіс визначення ціни товару з пріоритетами."""

from typing import Optional
from sqlalchemy.orm import Session
from backend.models.pricing import Price, ClientPriceOverride
from backend.models.references import Client


def get_price(
    db: Session,
    product_id: int,
    client_id: int,
    date: str,
    price_override: Optional[float] = None,
) -> float:
    """
    Повертає ціну товару для клієнта на задану дату.

    Пріоритети (від вищого до нижчого):
    1. price_override — передано явно (брак, акція на рядку замовлення)
    2. client_price_overrides — індивідуальна ціна клієнта
    3. базова ціна × (1 - discount_pct/100)
    4. базова ціна з prices (за датою)
    """

    # 1. Явний override
    if price_override is not None:
        return price_override

    # 2. Індивідуальна ціна клієнта
    override = (
        db.query(ClientPriceOverride)
        .filter(
            ClientPriceOverride.client_id == client_id,
            ClientPriceOverride.product_id == product_id,
            ClientPriceOverride.valid_from <= date,
        )
        .filter(
            (ClientPriceOverride.valid_to == None) | (ClientPriceOverride.valid_to >= date)
        )
        .order_by(ClientPriceOverride.valid_from.desc())
        .first()
    )
    if override:
        return override.price

    # 3 & 4. Базова ціна — шукаємо найактуальнішу
    base_price_row = (
        db.query(Price)
        .filter(
            Price.product_id == product_id,
            Price.is_active == 1,
            Price.valid_from <= date,
        )
        .filter(
            (Price.valid_to == None) | (Price.valid_to >= date)
        )
        .order_by(Price.valid_from.desc())
        .first()
    )

    if not base_price_row:
        return 0.0

    base = base_price_row.price

    # 3. Застосовуємо знижку клієнта
    client = db.get(Client, client_id)
    if client and client.discount_pct:
        base = base * (1 - client.discount_pct / 100)

    return round(base, 4)
