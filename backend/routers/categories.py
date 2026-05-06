"""Ендпоінти для категорій та одиниць виміру."""

from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models.references import Category, Unit
from backend.schemas.references import CategoryOut, CategoryUpdate, UnitOut, UnitUpdate
from backend.routers.auth import require_admin

router = APIRouter(tags=["Довідники"])


@router.get("/categories", response_model=List[CategoryOut])
def list_categories(active_only: bool = False, db: Session = Depends(get_db)):
    q = db.query(Category)
    if active_only:
        q = q.filter(Category.is_active == 1)
    return q.order_by(Category.sort_order, Category.name).all()


@router.post("/categories", response_model=CategoryOut, status_code=201)
def create_category(name: str, db: Session = Depends(get_db), _=Depends(require_admin)):
    c = Category(name=name)
    db.add(c)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Категорія з назвою «{name}» вже існує")
    db.refresh(c)
    return c


@router.put("/categories/{category_id}", response_model=CategoryOut)
def update_category(category_id: int, body: CategoryUpdate, db: Session = Depends(get_db), _=Depends(require_admin)):
    c = db.get(Category, category_id)
    if not c:
        raise HTTPException(status_code=404, detail="Категорію не знайдено")
    if body.name is not None:
        c.name = body.name
    if body.is_active is not None:
        c.is_active = body.is_active
    if body.is_baked is not None:
        c.is_baked = body.is_baked
    if body.reserve_pct is not None:
        c.reserve_pct = body.reserve_pct
    if body.sort_order is not None:
        c.sort_order = body.sort_order
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Категорія з назвою «{body.name}» вже існує")
    db.refresh(c)
    return c


@router.delete("/categories/{category_id}", status_code=204)
def delete_category(category_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    from backend.models.references import Product
    c = db.get(Category, category_id)
    if not c:
        raise HTTPException(status_code=404, detail="Категорію не знайдено")
    # Перевірка сирот: чи є вироби у цій категорії
    used_count = db.query(Product).filter(Product.category_id == category_id).count()
    if used_count:
        raise HTTPException(
            status_code=409,
            detail=f"Категорію використовують {used_count} виробів. Спочатку перенесіть їх або деактивуйте.",
        )
    db.delete(c)
    db.commit()


@router.get("/units", response_model=List[UnitOut])
def list_units(active_only: bool = False, db: Session = Depends(get_db)):
    q = db.query(Unit)
    if active_only:
        q = q.filter(Unit.is_active == 1)
    return q.order_by(Unit.name).all()


@router.post("/units", response_model=UnitOut, status_code=201)
def create_unit(name: str, db: Session = Depends(get_db), _=Depends(require_admin)):
    u = Unit(name=name)
    db.add(u)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Одиниця з назвою «{name}» вже існує")
    db.refresh(u)
    return u


@router.put("/units/{unit_id}", response_model=UnitOut)
def update_unit(unit_id: int, body: UnitUpdate, db: Session = Depends(get_db), _=Depends(require_admin)):
    u = db.get(Unit, unit_id)
    if not u:
        raise HTTPException(status_code=404, detail="Одиницю не знайдено")
    if body.name is not None:
        u.name = body.name
    if body.is_active is not None:
        u.is_active = body.is_active
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Одиниця з назвою «{body.name}» вже існує")
    db.refresh(u)
    return u


@router.delete("/units/{unit_id}", status_code=204)
def delete_unit(unit_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    from backend.models.references import Product, Ingredient
    u = db.get(Unit, unit_id)
    if not u:
        raise HTTPException(status_code=404, detail="Одиницю не знайдено")
    p_count = db.query(Product).filter(Product.unit_id == unit_id).count()
    i_count = db.query(Ingredient).filter(Ingredient.unit_id == unit_id).count()
    if p_count or i_count:
        raise HTTPException(
            status_code=409,
            detail=f"Одиницю використовують {p_count} виробів і {i_count} інгредієнтів.",
        )
    db.delete(u)
    db.commit()
