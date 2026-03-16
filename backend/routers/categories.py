"""Ендпоінти для категорій та одиниць виміру."""

from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models.references import Category, Unit
from backend.schemas.references import CategoryOut, UnitOut

router = APIRouter(tags=["Довідники"])


@router.get("/categories", response_model=List[CategoryOut])
def list_categories(db: Session = Depends(get_db)):
    return db.query(Category).order_by(Category.name).all()


@router.post("/categories", response_model=CategoryOut, status_code=201)
def create_category(name: str, db: Session = Depends(get_db)):
    c = Category(name=name)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@router.get("/units", response_model=List[UnitOut])
def list_units(db: Session = Depends(get_db)):
    return db.query(Unit).order_by(Unit.name).all()


@router.post("/units", response_model=UnitOut, status_code=201)
def create_unit(name: str, db: Session = Depends(get_db)):
    u = Unit(name=name)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u
