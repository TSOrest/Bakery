"""Ендпоінти для управління цінами."""

from typing import Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from datetime import datetime, date, timedelta

from backend.database import get_db
from backend.models.pricing import Price, ClientPriceOverride
from backend.models.references import Product, Client
from backend.schemas.pricing import (
    PriceCreate, PriceOut, PriceReplaceRequest,
    BulkChangeRequest, BulkChangePreview, BulkChangePreviewItem,
    ClientPriceOverrideCreate, ClientPriceOverrideOut,
)
from backend.services.prices import get_price, get_price_with_source

router = APIRouter(prefix="/prices", tags=["Ціни"])


# ── Ефективні ціни для клієнта ─────────────────────────────────────────────────

@router.get("/effective-batch")
def effective_prices_batch(client_ids: str, date: str, db: Session = Depends(get_db)):
    """Ефективні ціни для кількох клієнтів за один запит.
    client_ids — через кому: "1,2,3".
    Повертає {client_id: {product_id: {price, source}}}.
    Використовує 4 SQL-запити незалежно від кількості клієнтів і продуктів.
    """
    cids = [int(x) for x in client_ids.split(",") if x.strip().isdigit()]
    if not cids:
        return {}

    # 1. Усі продукти (включно з деактивованими — потрібні для відображення цін в існуючих записах)
    prod_ids: list[int] = [
        r[0] for r in db.query(Product.id).all()
    ]
    if not prod_ids:
        return {cid: {} for cid in cids}

    # 2. Найактуальніші базові ціни на дату (один запит)
    base_rows = (
        db.query(Price.product_id, Price.price)
        .filter(
            Price.product_id.in_(prod_ids),
            Price.valid_from <= date,
            or_(Price.valid_to.is_(None), Price.valid_to >= date),
        )
        .order_by(Price.product_id, Price.valid_from.desc())
        .all()
    )
    base_by_product: dict[int, float] = {}
    for pid, price in base_rows:
        if pid not in base_by_product:   # перший = найновіший valid_from
            base_by_product[pid] = price

    # 3. Індивідуальні ціни клієнтів на дату (один запит)
    override_rows = (
        db.query(
            ClientPriceOverride.client_id,
            ClientPriceOverride.product_id,
            ClientPriceOverride.price,
        )
        .filter(
            ClientPriceOverride.client_id.in_(cids),
            ClientPriceOverride.product_id.in_(prod_ids),
            ClientPriceOverride.valid_from <= date,
            or_(ClientPriceOverride.valid_to.is_(None), ClientPriceOverride.valid_to >= date),
        )
        .order_by(ClientPriceOverride.client_id, ClientPriceOverride.product_id,
                  ClientPriceOverride.valid_from.desc())
        .all()
    )
    override_by: dict[tuple[int, int], float] = {}
    for cid, pid, price in override_rows:
        key = (cid, pid)
        if key not in override_by:       # перший = найновіший valid_from
            override_by[key] = price

    # 4. Знижки клієнтів (один запит)
    discount_by: dict[int, float] = {
        c.id: (c.discount_pct or 0.0)
        for c in db.query(Client).filter(Client.id.in_(cids)).all()
    }

    # Збираємо відповідь
    result: dict[int, dict[int, dict]] = {}
    for cid in cids:
        disc = discount_by.get(cid, 0.0)
        client_prices: dict[int, dict] = {}
        for pid in prod_ids:
            ind = override_by.get((cid, pid))
            if ind is not None:
                client_prices[pid] = {"price": ind, "source": "individual"}
            else:
                base = base_by_product.get(pid)
                if base is None:
                    client_prices[pid] = {"price": 0.0, "source": "base"}
                elif disc:
                    client_prices[pid] = {
                        "price": round(base * (1 - disc / 100), 4),
                        "source": "discounted",
                    }
                else:
                    client_prices[pid] = {"price": base, "source": "base"}
        result[cid] = client_prices
    return result


@router.get("/effective")
def effective_prices_for_client(client_id: int, date: str, db: Session = Depends(get_db)):
    """Ефективні ціни всіх активних продуктів для клієнта на задану дату.
    Повертає {product_id: {price, source}} де source ∈ base|discounted|individual|manual.
    """
    prods = db.query(Product).filter(Product.is_active == 1).all()
    result = {}
    for p in prods:
        price, source = get_price_with_source(db, p.id, client_id, date)
        result[p.id] = {"price": price, "source": source}
    return result


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
    # Якщо нова ціна безстрокова — закриваємо попередні відкриті ціни того ж продукту
    if data.valid_to is None:
        prev_day = (date.fromisoformat(data.valid_from) - timedelta(days=1)).isoformat()
        prev_prices = (
            db.query(Price)
            .filter(
                Price.product_id == data.product_id,
                Price.is_active == 1,
                Price.valid_from < data.valid_from,
                Price.valid_to == None,
            )
            .all()
        )
        for pp in prev_prices:
            if prev_day >= pp.valid_from:
                pp.valid_to = prev_day
            else:
                pp.is_active = 0

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
    Дата набуття чинності має бути мінімум завтра.
    """
    old = db.get(Price, data.old_price_id)
    if not old:
        raise HTTPException(status_code=404, detail="Ціну не знайдено")

    eff = date.fromisoformat(data.effective_date)

    # Дата не може бути сьогодні або в минулому
    if eff <= date.today():
        raise HTTPException(
            status_code=400,
            detail="Дата набуття чинності має бути мінімум завтра",
        )

    # Перевіряємо колізію: чи вже є активна ціна з valid_from >= effective_date для цього продукту
    collision = (
        db.query(Price)
        .filter(
            Price.product_id == old.product_id,
            Price.is_active == 1,
            Price.valid_from >= data.effective_date,
            Price.id != data.old_price_id,
        )
        .first()
    )
    if collision:
        raise HTTPException(
            status_code=409,
            detail=f"Вже існує ціна з датою {collision.valid_from} для цього виробу",
        )

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
    excluded_ids:   str = Query(default=""),   # product_ids через кому
    db: Session = Depends(get_db),
):
    """Повертає попередній перегляд масової зміни цін (без збереження).
    Повертає valid_from поточної ціни і has_collision (якщо вже є ціна з >= effective_date).
    """
    excluded_set: set[int] = set()
    if excluded_ids:
        for x in excluded_ids.split(","):
            x = x.strip()
            if x.isdigit():
                excluded_set.add(int(x))

    # Поточні активні ціни (чинні на effective_date)
    active = (
        db.query(Price)
        .filter(
            Price.is_active == 1,
            Price.valid_from <= effective_date,
        )
        .filter(
            (Price.valid_to == None) | (Price.valid_to >= effective_date)
        )
        .order_by(Price.product_id, Price.valid_from.desc())
        .all()
    )

    # Майбутні ціни для колізійної перевірки: valid_from > effective_date
    future_prices: dict[int, str] = {}
    future_rows = (
        db.query(Price)
        .filter(Price.is_active == 1, Price.valid_from > effective_date)
        .all()
    )
    for fp in future_rows:
        if fp.product_id not in future_prices:
            future_prices[fp.product_id] = fp.valid_from

    products = {p.id: p.name for p in db.query(Product).all()}
    items = []
    seen_products: set[int] = set()

    for p in active:
        if p.product_id in seen_products:
            continue
        if p.product_id in excluded_set:
            seen_products.add(p.product_id)
            continue
        seen_products.add(p.product_id)
        new_price = round(p.price * (1 + pct / 100), 2)

        collision_date = future_prices.get(p.product_id)
        items.append(BulkChangePreviewItem(
            product_id     = p.product_id,
            product_name   = products.get(p.product_id, f"#{p.product_id}"),
            old_price      = p.price,
            new_price      = new_price,
            valid_from     = p.valid_from,
            has_collision  = collision_date is not None,
            collision_date = collision_date,
        ))

    return BulkChangePreview(items=items)


@router.post("/bulk-change")
def bulk_change(data: BulkChangeRequest, db: Session = Depends(get_db)):
    """
    Масова зміна цін:
    - Закриває всі поточні активні ціни (valid_to = effective_date - 1 день)
    - Створює нові з % зміною, що починаються з effective_date
    - Пропускає вироби з excluded_product_ids
    - Дата набуття чинності має бути мінімум завтра
    """
    eff = date.fromisoformat(data.effective_date)

    # Дата не може бути сьогодні або в минулому
    if eff <= date.today():
        raise HTTPException(
            status_code=400,
            detail="Дата набуття чинності має бути мінімум завтра",
        )

    excluded_set = set(data.excluded_product_ids)
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
        .order_by(Price.product_id, Price.valid_from.desc())
        .all()
    )

    created = 0
    seen_products: set[int] = set()

    for p in active:
        # Пропускаємо вироби зі списку виключень
        if p.product_id in excluded_set:
            continue
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
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Індивідуальна ціна для цього клієнта, виробу і дати вже існує")
    db.refresh(o)
    return o


@router.delete("/overrides/{override_id}", status_code=204)
def delete_override(override_id: int, db: Session = Depends(get_db)):
    o = db.get(ClientPriceOverride, override_id)
    if not o:
        raise HTTPException(status_code=404, detail="Запис не знайдено")
    db.delete(o)
    db.commit()
