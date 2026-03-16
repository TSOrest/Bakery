"""Ендпоінти для завдань на випічку."""

import math
from typing import List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.baking import BakingTask, SurplusAllocation, SurplusAllocationLine
from backend.schemas.baking import (
    BakingTaskOut, BakingTaskUpdate,
    SurplusAllocationCreate, SurplusAllocationOut,
    SurplusLineCreate, SurplusLineOut,
)
from backend.services.orders import aggregate_for_baking

router = APIRouter(prefix="/baking", tags=["Випічка"])


# ── Завдання на випічку ──────────────────────────────────────────────────────

@router.get("/tasks", response_model=List[BakingTaskOut])
def get_baking_tasks(task_date: str, db: Session = Depends(get_db)):
    return db.query(BakingTask).filter(BakingTask.task_date == task_date).all()


@router.post("/tasks/generate")
def generate_tasks(task_date: str, db: Session = Depends(get_db)):
    """
    Генерує завдання на випічку на основі замовлень.
    Резерв (bun_reserve_pct / bread_reserve_pct) додається і заокруглюється вгору
    до цілого — не можна спекти пів-буханки.
    """
    from backend.models.references import Product
    from backend.models.settings import Setting

    def _setting(key: str, default: str) -> float:
        row = db.query(Setting).filter(Setting.key == key).first()
        return float(row.value if row else default)

    bun_reserve   = _setting("bun_reserve_pct",   "5")
    bread_reserve = _setting("bread_reserve_pct",  "5")

    aggregated = aggregate_for_baking(db, task_date)
    created = updated = 0

    for row in aggregated:
        product = db.get(Product, row["product_id"])
        if not product:
            continue

        reserve_pct = bun_reserve if product.type == "bun" else bread_reserve
        # math.ceil — результат завжди ціле число
        recommended = math.ceil(row["ordered_qty"] * (1 + reserve_pct / 100))

        existing = db.query(BakingTask).filter(
            BakingTask.task_date == task_date,
            BakingTask.product_id == row["product_id"],
        ).first()

        if existing:
            existing.ordered_qty     = row["ordered_qty"]
            existing.recommended_qty = recommended
            updated += 1
        else:
            db.add(BakingTask(
                task_date       = task_date,
                product_id      = row["product_id"],
                ordered_qty     = row["ordered_qty"],
                recommended_qty = recommended,
                created_at      = datetime.now().isoformat(),
            ))
            created += 1

    db.commit()
    return {"generated": created, "updated": updated}


@router.put("/tasks/{task_id}", response_model=BakingTaskOut)
def update_task(task_id: int, data: BakingTaskUpdate, db: Session = Depends(get_db)):
    task = db.get(BakingTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Завдання не знайдено")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(task, field, value)
    db.commit()
    db.refresh(task)
    return task


# ── Клієнти що замовили виріб (для обробки нестачі) ─────────────────────────

@router.get("/shortage-clients")
def get_shortage_clients(task_date: str, product_id: int, db: Session = Depends(get_db)):
    """Повертає список клієнтів з замовленнями на цей виріб — щоб оператор міг узгодити зменшення."""
    from backend.models.orders import Order
    from backend.models.references import Client, Route

    orders = (
        db.query(Order)
        .filter(Order.order_date == task_date, Order.product_id == product_id)
        .all()
    )

    result = []
    for o in orders:
        client = db.get(Client, o.client_id)
        if not client:
            continue
        route = db.get(Route, client.route_id) if client.route_id else None
        result.append({
            "order_id":   o.id,
            "client_id":  o.client_id,
            "client_name": client.short_name or client.full_name,
            "route_name": route.name if route else "—",
            "ordered_qty": o.qty,
        })

    return sorted(result, key=lambda x: x["route_name"])


# ── Рядки розподілу надлишків ────────────────────────────────────────────────

@router.get("/surplus-lines", response_model=List[SurplusLineOut])
def get_surplus_lines(alloc_date: str, db: Session = Depends(get_db)):
    return (
        db.query(SurplusAllocationLine)
        .filter(SurplusAllocationLine.alloc_date == alloc_date)
        .all()
    )


@router.post("/surplus-lines", response_model=SurplusLineOut, status_code=201)
def create_surplus_line(data: SurplusLineCreate, db: Session = Depends(get_db)):
    line = SurplusAllocationLine(
        **data.model_dump(),
        created_at=datetime.now().isoformat(),
    )
    db.add(line)
    db.commit()
    db.refresh(line)
    return line


@router.delete("/surplus-lines/{line_id}", status_code=204)
def delete_surplus_line(line_id: int, db: Session = Depends(get_db)):
    line = db.get(SurplusAllocationLine, line_id)
    if not line:
        raise HTTPException(status_code=404, detail="Рядок не знайдено")
    db.delete(line)
    db.commit()


# ── Старий ендпоінт surplus (summary, залишається для сумісності) ────────────

@router.get("/surplus", response_model=List[SurplusAllocationOut])
def get_surplus(alloc_date: str, db: Session = Depends(get_db)):
    return db.query(SurplusAllocation).filter(SurplusAllocation.alloc_date == alloc_date).all()


@router.post("/surplus", response_model=SurplusAllocationOut, status_code=201)
def create_or_update_surplus(data: SurplusAllocationCreate, db: Session = Depends(get_db)):
    existing = db.query(SurplusAllocation).filter(
        SurplusAllocation.alloc_date == data.alloc_date,
        SurplusAllocation.product_id == data.product_id,
    ).first()

    if existing:
        for field, value in data.model_dump().items():
            setattr(existing, field, value)
        db.commit()
        db.refresh(existing)
        return existing

    alloc = SurplusAllocation(**data.model_dump())
    db.add(alloc)
    db.commit()
    db.refresh(alloc)
    return alloc
