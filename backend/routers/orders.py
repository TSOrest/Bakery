"""Ендпоінти для замовлень."""

from typing import List, Optional, Dict
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from datetime import datetime, date, timedelta
from backend.database import get_db, safe_commit
from backend.models.orders import Order
from backend.schemas.orders import OrderCreate, OrderUpdate, OrderOut, TransferRequest, OrderWithChildrenOut
from backend.services.orders import copy_orders
from backend.routers.auth import require_user

router = APIRouter(prefix="/orders", tags=["Замовлення"])


# ── Середні замовлення (фіксований маршрут перед /{order_id}) ─────────────────

@router.get("/averages", response_model=Dict[int, float])
def order_averages(
    client_id: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Середня кількість по кожному виробу за період (за замовчуванням — останні 30 днів)."""
    if not date_to:
        date_to = date.today().isoformat()
    if not date_from:
        date_from = (date.today() - timedelta(days=30)).isoformat()

    q = (
        db.query(Order.product_id, func.avg(Order.qty).label("avg_qty"))
        .filter(
            Order.order_date >= date_from,
            Order.order_date <= date_to,
            Order.parent_order_id.is_(None),
        )
    )
    if client_id:
        q = q.filter(Order.client_id == client_id)
    rows = q.group_by(Order.product_id).all()
    return {row.product_id: round(row.avg_qty, 1) for row in rows}


@router.get("/", response_model=List[OrderOut])
def list_orders(
    order_date: Optional[str] = None,
    client_id: Optional[int] = None,
    product_id: Optional[int] = None,
    origin_id: Optional[str] = None,   # "0" = надлишки, "null" = звичайні, інше = ID джерела
    db: Session = Depends(get_db),
):
    q = db.query(Order)
    if order_date:
        q = q.filter(Order.order_date == order_date)
    if client_id:
        q = q.filter(Order.client_id == client_id)
    if product_id:
        q = q.filter(Order.product_id == product_id)
    if origin_id == "null":
        q = q.filter(Order.origin_id.is_(None))
    elif origin_id is not None:
        q = q.filter(Order.origin_id == int(origin_id))
    return q.order_by(Order.client_id, Order.product_id).all()


@router.get("/{order_id}", response_model=OrderOut)
def get_order(order_id: int, db: Session = Depends(get_db)):
    o = db.get(Order, order_id)
    if not o:
        raise HTTPException(status_code=404, detail="Замовлення не знайдено")
    return o


@router.post("/", response_model=OrderOut, status_code=201)
def create_order(data: OrderCreate, db: Session = Depends(get_db), _=Depends(require_user)):
    o = Order(**data.model_dump(), created_at=datetime.now().isoformat())
    db.add(o)
    safe_commit(db)
    db.refresh(o)
    return o


@router.put("/{order_id}", response_model=OrderOut)
def update_order(order_id: int, data: OrderUpdate, db: Session = Depends(get_db), _=Depends(require_user)):
    o = db.get(Order, order_id)
    if not o:
        raise HTTPException(status_code=404, detail="Замовлення не знайдено")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(o, field, value)
    safe_commit(db)
    db.refresh(o)
    return o


@router.delete("/{order_id}", status_code=204)
def delete_order(order_id: int, db: Session = Depends(get_db), _=Depends(require_user)):
    o = db.get(Order, order_id)
    if not o:
        raise HTTPException(status_code=404, detail="Замовлення не знайдено")
    db.delete(o)
    safe_commit(db, conflict_msg="Не вдалось видалити: на замовлення посилаються інші записи")


@router.post("/{order_id}/transfer", response_model=OrderWithChildrenOut)
def transfer_order(
    order_id: int,
    data: TransferRequest,
    db: Session = Depends(get_db),
    _=Depends(require_user),
):
    """
    Переміщує частину замовлення іншому клієнту.
    Створює дочірній рядок (parent_order_id=order_id, origin_id=order_id)
    зі збереженням повної історії.
    """
    parent = db.get(Order, order_id)
    if not parent:
        raise HTTPException(status_code=404, detail="Замовлення не знайдено")

    # Вже переміщена кількість
    already = (
        db.query(func.coalesce(func.sum(Order.qty), 0.0))
        .filter(Order.parent_order_id == order_id, Order.client_id != parent.client_id)
        .scalar()
    ) or 0.0

    if data.qty <= 0:
        raise HTTPException(status_code=400, detail="Кількість має бути > 0")
    if data.qty > parent.qty - already:
        raise HTTPException(
            status_code=400,
            detail=f"Неможливо перемістити {data.qty}: доступно {parent.qty - already}",
        )

    child = Order(
        parent_order_id=order_id,
        origin_id=order_id,
        client_id=data.to_client_id,
        product_id=parent.product_id,
        order_date=parent.order_date,
        qty=data.qty,
        source="phone",
        notes=data.notes,
        created_at=datetime.now().isoformat(),
    )
    db.add(child)
    safe_commit(db)
    db.refresh(parent)
    return parent


@router.post("/copy", status_code=200)
def copy_orders_endpoint(
    source_date: str,
    target_date: str,
    client_ids: Optional[List[int]] = None,
    db: Session = Depends(get_db),
    _=Depends(require_user),
):
    """Копіює замовлення з однієї дати на іншу."""
    count = copy_orders(db, source_date, target_date, client_ids)
    return {"copied": count}
