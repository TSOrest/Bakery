"""Ендпоінти для управління цінами."""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, date, timedelta

from backend.database import get_db
from backend.models.pricing import Price, ClientPriceOverride
from backend.models.references import Product
from backend.schemas.pricing import (
    PriceCreate, PriceOut, PriceReplaceRequest,
    BulkChangeRequest, BulkChangePreview, BulkChangePreviewItem,
    ClientPriceOverrideCreate, ClientPriceOverrideOut,
)
from backend.services.prices import get_price

router = APIRouter(prefix="/prices", tags=["Ціни"])


# ── Базові ціни ────────────────────────────────────────────────────────────────

@router.get("/", response_model=List[PriceOut])
def list_prices(
    product_id:  Optional[int] = None,
    active_only: bool = True,
    db: Session = Depends(get_db),
):
    q = db.query(Price)
    if active_only:
        q = q.filter(Price.is_active == 1)
    if product_id:
        q = q.filter(Price.product_id == product_id)
    return q.order_by(Price.product_id, Price.valid_from.desc()).all()


@router.post("/", response_model=PriceOut, status_code=201)
def create_price(data: PriceCreate, db: Session = Depends(get_db)):
    p = Price(**data.model_dump(), created_at=datetime.now().isoformat())
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


# ВАЖЛИВО: фіксовані шляхи (/replace, /bulk-preview, /bulk-change, /resolve)
# мають бути оголошені ДО параметризованих (/{price_id}), інакше FastAPI
# матчить "replace" як значення price_id і повертає 405.

@router.post("/replace", response_model=PriceOut, status_code=201)
def replace_price(data: PriceReplaceRequest, db: Session = Depends(get_db)):
    """
    Закриває стару ціну (old_price_id) і створює нову починаючи з effective_date.
    Стара ціна отримує valid_to = effective_date - 1 день.
    """
    old = db.get(Price, data.old_price_id)
    if not old:
        raise HTTPException(status_code=404, detail="Ціну не знайдено")

    eff  = date.fromisoformat(data.effective_date)
    prev = (eff - timedelta(days=1)).isoformat()

    # Закриваємо стару ціну
    if prev >= old.valid_from:
        old.valid_to = prev
    else:
        # Нова ціна стартує раніше або в той же день — деактивуємо стару
        old.is_active = 0

    new_p = Price(
        product_id  = old.product_id,
        category_id = old.category_id,
        price       = data.price,
        valid_from  = data.effective_date,
        is_active   = 1,
        created_at  = datetime.now().isoformat(),
    )
    db.add(new_p)
    db.commit()
    db.refresh(new_p)
    return new_p


@router.get("/bulk-preview", response_model=BulkChangePreview)
def bulk_preview(
    pct:            float,
    effective_date: str,
    db: Session  = Depends(get_db),
):
    """Повертає попередній перегляд масової зміни цін (без збереження)."""
    active = (
        db.query(Price)
        .filter(
            Price.is_active == 1,
            Price.valid_from <= effective_date,
        )
        .filter(
            (Price.valid_to == None) | (Price.valid_to >= effective_date)
        )
        .order_by(Price.product_id)
        .all()
    )

    products = {p.id: p.name for p in db.query(Product).all()}
    items = []
    seen_products: set[int] = set()

    for p in active:
        if p.product_id in seen_products:
            continue
        seen_products.add(p.product_id)
        new_price = round(p.price * (1 + pct / 100), 2)
        items.append(BulkChangePreviewItem(
            product_id   = p.product_id,
            product_name = products.get(p.product_id, f"#{p.product_id}"),
            old_price    = p.price,
            new_price    = new_price,
        ))

    return BulkChangePreview(items=items)


@router.post("/bulk-change")
def bulk_change(data: BulkChangeRequest, db: Session = Depends(get_db)):
    """
    Масова зміна цін:
    - Закриває всі поточні активні ціни (valid_to = effective_date - 1 день)
    - Створює нові з % зміною, що починаються з effective_date
    """
    eff      = date.fromisoformat(data.effective_date)
    prev_day = (eff - timedelta(days=1)).isoformat()
    eff_str  = data.effective_date

    active = (
        db.query(Price)
        .filter(
            Price.is_active == 1,
            Price.valid_from <= eff_str,
        )
        .filter(
            (Price.valid_to == None) | (Price.valid_to >= eff_str)
        )
        .all()
    )

    created = 0
    seen_products: set[int] = set()

    for p in active:
        # Беремо лише першу (найсвіжішу) ціну на виріб
        if p.product_id in seen_products:
            p.is_active = 0
            continue
        seen_products.add(p.product_id)

        # Закриваємо стару ціну
        if prev_day >= p.valid_from:
            p.valid_to = prev_day
        else:
            p.is_active = 0

        new_price = round(p.price * (1 + data.pct / 100), 2)
        db.add(Price(
            product_id  = p.product_id,
            category_id = p.category_id,
            price       = new_price,
            valid_from  = eff_str,
            is_active   = 1,
            created_at  = datetime.now().isoformat(),
        ))
        created += 1

    db.commit()
    return {"changed": created, "effective_date": eff_str}


@router.get("/resolve")
def resolve_price(
    product_id: int,
    client_id:  int,
    date:       str,
    db: Session = Depends(get_db),
):
    """Повертає актуальну ціну для клієнта+продукт на дату."""
    price = get_price(db, product_id, client_id, date)
    return {"price": price}


# ── Параметризований маршрут — після всіх фіксованих ─────────────────────────

@router.delete("/{price_id}", status_code=204)
def delete_price(price_id: int, db: Session = Depends(get_db)):
    """Деактивує ціну (встановлює is_active=0 і valid_to=сьогодні)."""
    p = db.get(Price, price_id)
    if not p:
        raise HTTPException(status_code=404, detail="Ціну не знайдено")
    p.is_active = 0
    if not p.valid_to:
        p.valid_to = date.today().isoformat()
    db.commit()


# ── Індивідуальні ціни клієнтів ───────────────────────────────────────────────

@router.get("/overrides", response_model=List[ClientPriceOverrideOut])
def list_overrides(
    client_id:  Optional[int] = None,
    product_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = db.query(ClientPriceOverride)
    if client_id:
        q = q.filter(ClientPriceOverride.client_id == client_id)
    if product_id:
        q = q.filter(ClientPriceOverride.product_id == product_id)
    return q.order_by(ClientPriceOverride.client_id, ClientPriceOverride.product_id).all()


@router.post("/overrides", response_model=ClientPriceOverrideOut, status_code=201)
def create_override(data: ClientPriceOverrideCreate, db: Session = Depends(get_db)):
    o = ClientPriceOverride(**data.model_dump())
    db.add(o)
    db.commit()
    db.refresh(o)
    return o


@router.delete("/overrides/{override_id}", status_code=204)
def delete_override(override_id: int, db: Session = Depends(get_db)):
    o = db.get(ClientPriceOverride, override_id)
    if not o:
        raise HTTPException(status_code=404, detail="Запис не знайдено")
    db.delete(o)
    db.commit()
