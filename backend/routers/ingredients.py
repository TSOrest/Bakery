"""Ендпоінти для інгредієнтів, складу виробів і звіту маржі."""

from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.database import get_db, safe_commit
from backend.models.references import Ingredient, ProductIngredient, Product
from backend.models.pricing import Price
from backend.schemas.ingredients import (
    IngredientCreate, IngredientUpdate, IngredientOut,
    ProductIngredientCreate, ProductIngredientOut,
    MarginRow, MarginReport,
)
from backend.services.costs import calculate_cost, recalculate_all_costs
from backend.routers.auth import require_admin

router = APIRouter(tags=["Інгредієнти"])


# ── Інгредієнти ───────────────────────────────────────────────────────────────

@router.get("/ingredients/", response_model=List[IngredientOut])
def list_ingredients(db: Session = Depends(get_db)):
    return db.query(Ingredient).order_by(Ingredient.name).all()


@router.post("/ingredients/", response_model=IngredientOut, status_code=201)
def create_ingredient(data: IngredientCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    ing = Ingredient(**data.model_dump())
    db.add(ing)
    safe_commit(db)
    db.refresh(ing)
    return ing


@router.put("/ingredients/{ingredient_id}", response_model=IngredientOut)
def update_ingredient(
    ingredient_id: int,
    data: IngredientUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    ing = db.get(Ingredient, ingredient_id)
    if not ing:
        raise HTTPException(status_code=404, detail="Інгредієнт не знайдено")

    update_data = data.model_dump(exclude_unset=True)
    price_changed = "price_per_unit" in update_data

    for field, value in update_data.items():
        setattr(ing, field, value)

    if price_changed:
        ing.price_updated_at = datetime.now().isoformat()

    safe_commit(db)
    db.refresh(ing)

    # Перерахунок собівартості для всіх виробів що містять цей інгредієнт
    if price_changed:
        affected = (
            db.query(ProductIngredient)
            .filter(ProductIngredient.ingredient_id == ingredient_id)
            .all()
        )
        for pi in affected:
            calculate_cost(db, pi.product_id)

    return ing


@router.delete("/ingredients/{ingredient_id}", status_code=204)
def delete_ingredient(ingredient_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    ing = db.get(Ingredient, ingredient_id)
    if not ing:
        raise HTTPException(status_code=404, detail="Інгредієнт не знайдено")
    # Перевіряємо чи не використовується
    used = db.query(ProductIngredient).filter(
        ProductIngredient.ingredient_id == ingredient_id
    ).count()
    if used:
        raise HTTPException(
            status_code=400,
            detail=f"Інгредієнт використовується у {used} виробах. Спочатку видаліть його зі складу.",
        )
    db.delete(ing)
    safe_commit(db)


# ── Склад виробу ──────────────────────────────────────────────────────────────

@router.get("/products/{product_id}/ingredients", response_model=List[ProductIngredientOut])
def get_product_ingredients(product_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(ProductIngredient)
        .filter(ProductIngredient.product_id == product_id)
        .all()
    )
    result = []
    for r in rows:
        ing = db.get(Ingredient, r.ingredient_id)
        unit_name = ""
        if ing and ing.unit_id:
            from backend.models.references import Unit
            u = db.get(Unit, ing.unit_id)
            unit_name = u.name if u else ""
        result.append(ProductIngredientOut(
            id            = r.id,
            product_id    = r.product_id,
            ingredient_id = r.ingredient_id,
            qty_per_unit  = r.qty_per_unit,
            ingredient_name = ing.name if ing else f"#{r.ingredient_id}",
            unit_name       = unit_name,
            price_per_unit  = ing.price_per_unit if ing else 0.0,
            line_cost       = round(r.qty_per_unit * (ing.price_per_unit if ing else 0), 4),
        ))
    return result


@router.post("/products/{product_id}/ingredients", response_model=ProductIngredientOut, status_code=201)
def add_product_ingredient(
    product_id: int,
    data: ProductIngredientCreate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    if not db.get(Product, product_id):
        raise HTTPException(status_code=404, detail="Виріб не знайдено")

    # Перевірка дублікату
    exists = db.query(ProductIngredient).filter(
        ProductIngredient.product_id    == product_id,
        ProductIngredient.ingredient_id == data.ingredient_id,
    ).first()
    if exists:
        raise HTTPException(status_code=400, detail="Цей інгредієнт вже є у складі виробу")

    pi = ProductIngredient(
        product_id    = product_id,
        ingredient_id = data.ingredient_id,
        qty_per_unit  = data.qty_per_unit,
    )
    db.add(pi)
    try:
        safe_commit(db)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Цей інгредієнт вже є у складі виробу")
    db.refresh(pi)

    calculate_cost(db, product_id)

    ing = db.get(Ingredient, data.ingredient_id)
    unit_name = ""
    if ing and ing.unit_id:
        from backend.models.references import Unit
        u = db.get(Unit, ing.unit_id)
        unit_name = u.name if u else ""

    return ProductIngredientOut(
        id              = pi.id,
        product_id      = pi.product_id,
        ingredient_id   = pi.ingredient_id,
        qty_per_unit    = pi.qty_per_unit,
        ingredient_name = ing.name if ing else "",
        unit_name       = unit_name,
        price_per_unit  = ing.price_per_unit if ing else 0.0,
        line_cost       = round(pi.qty_per_unit * (ing.price_per_unit if ing else 0), 4),
    )


@router.put("/products/{product_id}/ingredients/{pi_id}", response_model=ProductIngredientOut)
def update_product_ingredient(
    product_id: int,
    pi_id: int,
    qty_per_unit: float,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    pi = db.get(ProductIngredient, pi_id)
    if not pi or pi.product_id != product_id:
        raise HTTPException(status_code=404, detail="Запис не знайдено")
    pi.qty_per_unit = qty_per_unit
    safe_commit(db)
    calculate_cost(db, product_id)

    ing = db.get(Ingredient, pi.ingredient_id)
    unit_name = ""
    if ing and ing.unit_id:
        from backend.models.references import Unit
        u = db.get(Unit, ing.unit_id)
        unit_name = u.name if u else ""

    return ProductIngredientOut(
        id              = pi.id,
        product_id      = pi.product_id,
        ingredient_id   = pi.ingredient_id,
        qty_per_unit    = pi.qty_per_unit,
        ingredient_name = ing.name if ing else "",
        unit_name       = unit_name,
        price_per_unit  = ing.price_per_unit if ing else 0.0,
        line_cost       = round(pi.qty_per_unit * (ing.price_per_unit if ing else 0), 4),
    )


@router.delete("/products/{product_id}/ingredients/{pi_id}", status_code=204)
def remove_product_ingredient(
    product_id: int,
    pi_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    pi = db.get(ProductIngredient, pi_id)
    if not pi or pi.product_id != product_id:
        raise HTTPException(status_code=404, detail="Запис не знайдено")
    db.delete(pi)
    safe_commit(db)
    calculate_cost(db, product_id)


# ── Перерахунок всіх собівартостей ───────────────────────────────────────────

@router.post("/ingredients/recalculate-all")
def recalculate_all(db: Session = Depends(get_db), _=Depends(require_admin)):
    """Примусово перераховує cost_per_unit для всіх активних виробів."""
    count = recalculate_all_costs(db)
    return {"recalculated": count}


# ── Звіт маржі ────────────────────────────────────────────────────────────────

@router.get("/margin-report", response_model=MarginReport)
def margin_report(date: Optional[str] = None, db: Session = Depends(get_db)):
    """
    Звіт маржинальності: собівартість vs поточна ціна для кожного активного виробу.
    date — дата для визначення актуальної ціни (за замовчуванням сьогодні).
    """
    from datetime import date as date_type
    ref_date = date or date_type.today().isoformat()

    products = db.query(Product).filter(Product.is_active == 1).order_by(Product.name).all()

    # Отримуємо поточні активні ціни для кожного продукту
    active_prices = (
        db.query(Price)
        .filter(
            Price.is_active == 1,
            Price.valid_from <= ref_date,
        )
        .filter(
            (Price.valid_to == None) | (Price.valid_to >= ref_date)
        )
        .order_by(Price.product_id, Price.valid_from.desc())
        .all()
    )
    price_map: dict[int, float] = {}
    for p in active_prices:
        if p.product_id not in price_map:
            price_map[p.product_id] = p.price

    rows = []
    for p in products:
        price     = price_map.get(p.id, 0.0)
        cost      = p.cost_per_unit or 0.0
        margin    = round(price - cost, 4)
        margin_pct = round(margin / price * 100, 2) if price else 0.0
        rows.append(MarginRow(
            product_id   = p.id,
            product_name = p.name,
            cost_per_unit = cost,
            price         = price,
            margin_grn    = margin,
            margin_pct    = margin_pct,
        ))

    return MarginReport(rows=rows)
