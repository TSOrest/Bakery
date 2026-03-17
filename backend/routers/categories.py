"""Ендпоінти для категорій та одиниць виміру."""

from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models.references import Category, Unit
from backend.schemas.references import CategoryOut, CategoryUpdate, UnitOut, UnitUpdate

router = APIRouter(tags=["Довідники"])


@router.get("/categories", response_model=List[CategoryOut])
def list_categories(active_only: bool = False, db: Session = Depends(get_db)):
    q = db.query(Category)
    if active_only:
        q = q.filter(Category.is_active == 1)
    return q.order_by(Category.name).all()


@router.post("/categories", response_model=CategoryOut, status_code=201)
def create_category(name: str, db: Session = Depends(get_db)):
    c = Category(name=name)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@router.put("/categories/{category_id}", response_model=CategoryOut)
def update_category(category_id: int, body: CategoryUpdate, db: Session = Depends(get_db)):
    c = db.get(Category, category_id)
    if not c:
        raise HTTPException(status_code=404, detail="Категорію не знайдено")
    if body.name is not None:
        c.name = body.name
    if body.is_active is not None:
        c.is_active = body.is_active
    db.commit()
    db.refresh(c)
    return c


@router.delete("/categories/{category_id}", status_code=204)
def delete_category(category_id: int, db: Session = Depends(get_db)):
    c = db.get(Category, category_id)
    if not c:
        raise HTTPException(status_code=404, detail="Категорію не знайдено")
    db.delete(c)
    db.commit()


@router.get("/units", response_model=List[UnitOut])
def list_units(active_only: bool = False, db: Session = Depends(get_db)):
    q = db.query(Unit)
    if active_only:
        q = q.filter(Unit.is_active == 1)
    return q.order_by(Unit.name).all()


@router.post("/units", response_model=UnitOut, status_code=201)
def create_unit(name: str, db: Session = Depends(get_db)):
    u = Unit(name=name)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@router.put("/units/{unit_id}", response_model=UnitOut)
def update_unit(unit_id: int, body: UnitUpdate, db: Session = Depends(get_db)):
    u = db.get(Unit, unit_id)
    if not u:
        raise HTTPException(status_code=404, detail="Одиницю не знайдено")
    if body.name is not None:
        u.name = body.name
    if body.is_active is not None:
        u.is_active = body.is_active
    db.commit()
    db.refresh(u)
    return u


@router.delete("/units/{unit_id}", status_code=204)
def delete_unit(unit_id: int, db: Session = Depends(get_db)):
    u = db.get(Unit, unit_id)
    if not u:
        raise HTTPException(status_code=404, detail="Одиницю не знайдено")
    db.delete(u)
    db.commit()
