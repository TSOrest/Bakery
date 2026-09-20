"""Ендпоінти для довідника виробів."""

from datetime import datetime as dt
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session
from backend.database import get_db, safe_commit
from backend.models.references import Product
from backend.schemas.references import ProductCreate, ProductUpdate, ProductOut
from backend.routers.auth import require_perm, require_user

router = APIRouter(prefix="/products", tags=["Вироби"])


@router.get("/age")
def get_product_ages(date: Optional[str] = None, db: Session = Depends(get_db), _=Depends(require_user)):
    """Вік кожного виробу в днях (від дати останньої випічки до заданої дати).
    Повертає лише ті вироби, де baked_qty > 0 і є випічка до зазначеної дати."""
    ref = date or dt.now().strftime('%Y-%m-%d')
    rows = db.execute(text("""
        SELECT bt.product_id,
               bt.task_date,
               CAST(julianday(:ref) - julianday(bt.task_date) AS INTEGER) AS age_days
        FROM baking_tasks bt
        WHERE bt.task_date = (
            SELECT MAX(bt2.task_date)
            FROM baking_tasks bt2
            WHERE bt2.product_id = bt.product_id
              AND bt2.baked_qty > 0
              AND bt2.task_date <= :ref
        )
          AND bt.baked_qty > 0
    """), {"ref": ref}).fetchall()
    return [
        {"product_id": int(r[0]), "baked_date": r[1], "age_days": int(r[2])}
        for r in rows
    ]


@router.get("/", response_model=List[ProductOut])
def list_products(
    active_only: bool = True,
    db: Session = Depends(get_db),
    _=Depends(require_user),
):
    q = db.query(Product)
    if active_only:
        q = q.filter(Product.is_active == 1)
    return q.order_by(Product.name).all()


@router.get("/{product_id}", response_model=ProductOut)
def get_product(product_id: int, db: Session = Depends(get_db), _=Depends(require_user)):
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(status_code=404, detail="Виріб не знайдено")
    return p


@router.post("/", response_model=ProductOut, status_code=201)
def create_product(data: ProductCreate, db: Session = Depends(get_db), _=Depends(require_perm("admin_goods.create"))):
    from datetime import datetime
    p = Product(**data.model_dump(), created_at=datetime.now().isoformat())
    db.add(p)
    safe_commit(db)
    db.refresh(p)
    return p


@router.put("/{product_id}", response_model=ProductOut)
def update_product(product_id: int, data: ProductUpdate, db: Session = Depends(get_db), _=Depends(require_perm("admin_goods.edit"))):
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(status_code=404, detail="Виріб не знайдено")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(p, field, value)
    safe_commit(db)
    db.refresh(p)
    return p


@router.delete("/{product_id}")
def deactivate_product(product_id: int, db: Session = Depends(get_db), _=Depends(require_perm("admin_goods.delete"))):
    """М'яке видалення — ставимо is_active=0.

    На відміну від маршрутів (deactivate_route), тут НЕ блокує дію —
    лише інформаційне попередження в відповіді, якщо виріб замовляли
    останні 30 днів (бізнес-правило "чи можна деактивувати" тут нечітке
    — на відміну від маршруту, де "активні клієнти" однозначні).
    """
    from datetime import timedelta
    from backend.models.orders import Order

    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(status_code=404, detail="Виріб не знайдено")
    p.is_active = 0
    safe_commit(db)

    cutoff = (dt.now() - timedelta(days=30)).strftime("%Y-%m-%d")
    recent_orders = db.query(Order).filter(
        Order.product_id == product_id, Order.order_date >= cutoff,
    ).count()
    warning = (
        f"Цей виріб замовляли {recent_orders} раз(ів) за останні 30 днів."
        if recent_orders else None
    )
    return {"deactivated": True, "warning": warning}
