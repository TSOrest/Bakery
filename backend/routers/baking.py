"""Ендпоінти для завдань на випічку."""

from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
from backend.database import get_db
from backend.models.baking import BakingTask, SurplusAllocation
from backend.schemas.baking import (
    BakingTaskOut, BakingTaskUpdate,
    SurplusAllocationCreate, SurplusAllocationOut,
)
from backend.services.orders import aggregate_for_baking

router = APIRouter(prefix="/baking", tags=["Випічка"])


@router.get("/tasks", response_model=List[BakingTaskOut])
def get_baking_tasks(task_date: str, db: Session = Depends(get_db)):
    return db.query(BakingTask).filter(BakingTask.task_date == task_date).all()


@router.post("/tasks/generate")
def generate_tasks(task_date: str, db: Session = Depends(get_db)):
    """
    Генерує завдання на випічку на основі підтверджених замовлень.
    Враховує резерв з налаштувань (bun_reserve_pct, bread_reserve_pct).
    """
    from backend.models.references import Product
    from backend.models.settings import Setting

    # Читаємо резерви
    bun_reserve = float(
        (db.query(Setting).filter(Setting.key == "bun_reserve_pct").first() or type("S", (), {"value": "5"})()).value
    )
    bread_reserve = float(
        (db.query(Setting).filter(Setting.key == "bread_reserve_pct").first() or type("S", (), {"value": "5"})()).value
    )

    aggregated = aggregate_for_baking(db, task_date)
    created = 0

    for row in aggregated:
        product = db.get(Product, row["product_id"])
        if not product:
            continue

        reserve_pct = bun_reserve if product.type == "bun" else bread_reserve
        recommended = round(row["ordered_qty"] * (1 + reserve_pct / 100), 2)

        existing = db.query(BakingTask).filter(
            BakingTask.task_date == task_date,
            BakingTask.product_id == row["product_id"],
        ).first()

        if existing:
            existing.ordered_qty = row["ordered_qty"]
            existing.recommended_qty = recommended
        else:
            task = BakingTask(
                task_date=task_date,
                product_id=row["product_id"],
                ordered_qty=row["ordered_qty"],
                recommended_qty=recommended,
                created_at=datetime.now().isoformat(),
            )
            db.add(task)
            created += 1

    db.commit()
    return {"generated": created, "updated": len(aggregated) - created}


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


# --- Розподіл надлишків ---

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
