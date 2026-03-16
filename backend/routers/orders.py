"""Ендпоінти для замовлень."""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
from backend.database import get_db
from backend.models.orders import Order
from backend.schemas.orders import OrderCreate, OrderUpdate, OrderOut
from backend.services.orders import copy_orders

router = APIRouter(prefix="/orders", tags=["Замовлення"])


@router.get("/", response_model=List[OrderOut])
def list_orders(
    order_date: Optional[str] = None,
    client_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Order)
    if order_date:
        q = q.filter(Order.order_date == order_date)
    if client_id:
        q = q.filter(Order.client_id == client_id)
    return q.order_by(Order.client_id, Order.product_id).all()


@router.get("/{order_id}", response_model=OrderOut)
def get_order(order_id: int, db: Session = Depends(get_db)):
    o = db.get(Order, order_id)
    if not o:
        raise HTTPException(status_code=404, detail="Замовлення не знайдено")
    return o


@router.post("/", response_model=OrderOut, status_code=201)
def create_order(data: OrderCreate, db: Session = Depends(get_db)):
    o = Order(**data.model_dump(), created_at=datetime.now().isoformat())
    db.add(o)
    db.commit()
    db.refresh(o)
    return o


@router.put("/{order_id}", response_model=OrderOut)
def update_order(order_id: int, data: OrderUpdate, db: Session = Depends(get_db)):
    o = db.get(Order, order_id)
    if not o:
        raise HTTPException(status_code=404, detail="Замовлення не знайдено")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(o, field, value)
    db.commit()
    db.refresh(o)
    return o


@router.delete("/{order_id}", status_code=204)
def delete_order(order_id: int, db: Session = Depends(get_db)):
    o = db.get(Order, order_id)
    if not o:
        raise HTTPException(status_code=404, detail="Замовлення не знайдено")
    db.delete(o)
    db.commit()


@router.post("/copy", status_code=200)
def copy_orders_endpoint(
    source_date: str,
    target_date: str,
    client_ids: Optional[List[int]] = None,
    db: Session = Depends(get_db),
):
    """Копіює замовлення з однієї дати на іншу."""
    count = copy_orders(db, source_date, target_date, client_ids)
    return {"copied": count}
