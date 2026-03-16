"""Ендпоінти для управління цінами."""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
from backend.database import get_db
from backend.models.pricing import Price, ClientPriceOverride
from backend.schemas.pricing import (
    PriceCreate, PriceOut,
    ClientPriceOverrideCreate, ClientPriceOverrideOut,
)
from backend.services.prices import get_price

router = APIRouter(prefix="/prices", tags=["Ціни"])


@router.get("/", response_model=List[PriceOut])
def list_prices(product_id: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(Price).filter(Price.is_active == 1)
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


@router.get("/resolve")
def resolve_price(
    product_id: int,
    client_id: int,
    date: str,
    db: Session = Depends(get_db),
):
    """Повертає актуальну ціну для клієнта+продукт на дату."""
    price = get_price(db, product_id, client_id, date)
    return {"price": price}


# --- Індивідуальні ціни ---

@router.get("/overrides", response_model=List[ClientPriceOverrideOut])
def list_overrides(client_id: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(ClientPriceOverride)
    if client_id:
        q = q.filter(ClientPriceOverride.client_id == client_id)
    return q.all()


@router.post("/overrides", response_model=ClientPriceOverrideOut, status_code=201)
def create_override(data: ClientPriceOverrideCreate, db: Session = Depends(get_db)):
    o = ClientPriceOverride(**data.model_dump())
    db.add(o)
    db.commit()
    db.refresh(o)
    return o
