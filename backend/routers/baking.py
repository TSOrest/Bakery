"""Ендпоінти для завдань на випічку."""

import math
from typing import List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.database import get_db, safe_commit
from backend.models.baking import BakingTask
from backend.schemas.baking import BakingTaskOut, BakingTaskUpdate
from backend.services.orders import aggregate_for_baking
from backend.routers.auth import require_user

router = APIRouter(prefix="/baking", tags=["Випічка"])


# ── Завдання на випічку ──────────────────────────────────────────────────────

@router.get("/tasks", response_model=List[BakingTaskOut])
def get_baking_tasks(task_date: str, db: Session = Depends(get_db)):
    return db.query(BakingTask).filter(BakingTask.task_date == task_date).all()


@router.post("/tasks/generate")
def generate_tasks(task_date: str, db: Session = Depends(get_db), _=Depends(require_user)):
    """
    Генерує завдання на випічку на основі замовлень.
    Резерв (category.reserve_pct) додається і заокруглюється вгору
    до цілого — не можна спекти пів-буханки.

    При повторній генерації:
    - задачі для незамовлених виробів з baked_qty=0 видаляються
    - задачі для незамовлених виробів з baked_qty>0 обнуляють ordered/recommended
      (виріб вже спечено — залишається для розподілу надлишку)
    """
    from backend.models.references import Product, Category

    aggregated = aggregate_for_baking(db, task_date)
    created = updated = 0

    ordered_product_ids: set[int] = set()

    for row in aggregated:
        product = db.get(Product, row["product_id"])
        if not product:
            continue
        category = db.get(Category, product.category_id) if product.category_id else None
        # Пропускаємо вироби категорій що не випікаються (магазин/інше)
        if category and not category.is_baked:
            continue
        reserve_pct = category.reserve_pct if category else 5.0
        # math.ceil — результат завжди ціле число
        recommended = math.ceil(row["ordered_qty"] * (1 + reserve_pct / 100))

        # Ігноруємо вироби з нульовим підсумком замовлень (замовлення обнулені але не видалені)
        if row["ordered_qty"] <= 0:
            continue

        ordered_product_ids.add(row["product_id"])

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
                baked_qty       = None,  # NULL = ще не введено
                created_at      = datetime.now().isoformat(),
            ))
            created += 1

    # Прибираємо задачі для виробів що більше не замовлені
    removed = zeroed = 0
    stale_tasks = db.query(BakingTask).filter(
        BakingTask.task_date == task_date,
        BakingTask.product_id.notin_(ordered_product_ids),
    ).all()
    for task in stale_tasks:
        if task.baked_qty == 0:
            db.delete(task)
            removed += 1
        else:
            # Вже спечено — залишаємо але обнуляємо замовлення
            task.ordered_qty     = 0
            task.recommended_qty = 0
            zeroed += 1

    safe_commit(db)
    return {"generated": created, "updated": updated, "removed": removed, "zeroed": zeroed}


@router.post("/tasks/ensure", response_model=BakingTaskOut)
def ensure_task(task_date: str, product_id: int, db: Session = Depends(get_db), _=Depends(require_user)):
    """Створює задачу на випічку для виробу без замовлень якщо вона ще не існує."""
    existing = db.query(BakingTask).filter(
        BakingTask.task_date == task_date,
        BakingTask.product_id == product_id,
    ).first()
    if existing:
        return existing
    task = BakingTask(
        task_date=task_date,
        product_id=product_id,
        ordered_qty=0,
        recommended_qty=0,
        created_at=datetime.now().isoformat(),
    )
    db.add(task)
    safe_commit(db)
    db.refresh(task)
    return task


@router.put("/tasks/{task_id}", response_model=BakingTaskOut)
def update_task(task_id: int, data: BakingTaskUpdate, db: Session = Depends(get_db), _=Depends(require_user)):
    task = db.get(BakingTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Завдання не знайдено")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(task, field, value)
    safe_commit(db)
    db.refresh(task)
    return task


# ── Клієнти що замовили виріб (для обробки нестачі) ─────────────────────────

@router.get("/shortage-clients")
def get_shortage_clients(task_date: str, product_id: int, db: Session = Depends(get_db)):
    """Повертає список клієнтів з замовленнями на цей виріб — щоб оператор міг узгодити зменшення.

    Виключає: надлишки (origin_id IS NOT NULL), дочірні рядки (parent_order_id IS NOT NULL),
    та системних клієнтів (writeoff, ration, underbaked).
    Повертає existing_reduction — вже зафіксоване зменшення через дочірні рядки.
    """
    from backend.models.orders import Order
    from backend.models.references import Client, Route

    # Тільки батьківські звичайні замовлення клієнтів
    SYSTEM_KINDS = {'writeoff', 'ration', 'underbaked'}
    parent_orders = (
        db.query(Order)
        .filter(
            Order.order_date == task_date,
            Order.product_id == product_id,
            Order.origin_id.is_(None),
            Order.parent_order_id.is_(None),
        )
        .all()
    )

    result = []
    for o in parent_orders:
        client = db.get(Client, o.client_id)
        if not client or client.client_kind in SYSTEM_KINDS:
            continue
        route = db.get(Route, client.route_id) if client.route_id else None

        # Сума вже зафіксованих зменшень (дочірні рядки з underbaked-клієнтом)
        existing_reduction = (
            db.query(Order)
            .join(Client, Order.client_id == Client.id)
            .filter(
                Order.parent_order_id == o.id,
                Client.client_kind == 'underbaked',
            )
            .with_entities(func.coalesce(func.sum(Order.qty), 0))
            .scalar() or 0
        )

        # Ефективна ціна для рядка
        if o.exchange_type == "pre_order":
            effective_price = 0.0
        elif o.price_override is not None:
            effective_price = float(o.price_override)
        else:
            from backend.services.prices import get_price
            effective_price = get_price(db, o.product_id, o.client_id, task_date)

        result.append({
            "order_id":           o.id,
            "client_id":          o.client_id,
            "client_name":        client.short_name or client.full_name,
            "route_name":         route.name if route else "—",
            "ordered_qty":        o.qty,
            "existing_reduction": float(existing_reduction),
            "exchange_type":      o.exchange_type,
            "price_override":     o.price_override,
            "effective_price":    effective_price,
        })

    return sorted(result, key=lambda x: x["route_name"])


