"""Ендпоінти магазину: щоденна звірка та товари групи ІНШЕ."""

from datetime import date as date_type, timedelta
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.shop import ShopCount, OtherStockIn
from backend.models.baking import BakingTask, SurplusAllocationLine
from backend.models.references import Product, OtherProduct
from backend.schemas.shop import (
    ShopCountOut, ShopCountUpdate,
    OtherStockInCreate, OtherStockInOut,
)

router = APIRouter(prefix="/shop", tags=["Магазин"])


# ─── Звірка ──────────────────────────────────────────────────────────────────

@router.get("/counts", response_model=List[ShopCountOut])
def list_counts(count_date: str, db: Session = Depends(get_db)):
    rows = (
        db.query(ShopCount)
        .filter(ShopCount.count_date == count_date)
        .order_by(ShopCount.product_id)
        .all()
    )
    # Для незаблокованих рядків перераховуємо received_today актуально
    changed = False
    for sc in rows:
        if sc.saved:
            continue
        task = (
            db.query(BakingTask)
            .filter(BakingTask.task_date == count_date, BakingTask.product_id == sc.product_id)
            .first()
        )
        received = 0.0
        if task and task.baked_qty > task.ordered_qty:
            surplus = task.baked_qty - task.ordered_qty
            explicitly_allocated = sum(
                line.qty
                for line in db.query(SurplusAllocationLine)
                .filter(
                    SurplusAllocationLine.alloc_date == count_date,
                    SurplusAllocationLine.product_id == sc.product_id,
                )
                .all()
            )
            received = max(0.0, surplus - explicitly_allocated)
        if sc.received_today != received:
            sc.received_today = received
            changed = True
    if changed:
        db.commit()
    return rows


@router.post("/counts/init", response_model=List[ShopCountOut])
def init_counts(count_date: str, db: Session = Depends(get_db)):
    """
    Ініціалізує рядки звірки на задану дату:
    - Бере всі активні вироби, що мають задачу на випічку або залишок з вчора
    - Заповнює yesterday_balance з попереднього дня
    - Заповнює received_today з surplus_allocation_lines (to_shop)
    Якщо рядки вже існують — повертає наявні.
    """
    existing = db.query(ShopCount).filter(ShopCount.count_date == count_date).all()
    if existing:
        return existing

    prev_date = (date_type.fromisoformat(count_date) - timedelta(days=1)).isoformat()

    # Попередні залишки
    prev_counts: dict[int, float] = {}
    for sc in db.query(ShopCount).filter(ShopCount.count_date == prev_date).all():
        bal = sc.entered_balance if sc.entered_balance is not None else 0.0
        prev_counts[sc.product_id] = bal

    # Збираємо product_ids: з попередніх залишків + задач випічки
    product_ids: set[int] = set(prev_counts.keys())
    for task in db.query(BakingTask).filter(BakingTask.task_date == count_date).all():
        product_ids.add(task.product_id)

    rows: list[ShopCount] = []
    for pid in sorted(product_ids):
        product = db.get(Product, pid)
        if not product or not product.is_active:
            continue

        # received_today = надлишок після замовлень мінус явно розподілені рядки
        # Залишок надлишку йде до магазину неявно (відображається в SurplusPanel)
        task = (
            db.query(BakingTask)
            .filter(BakingTask.task_date == count_date, BakingTask.product_id == pid)
            .first()
        )
        shop_received = 0.0
        if task and task.baked_qty > task.ordered_qty:
            surplus = task.baked_qty - task.ordered_qty
            explicitly_allocated = sum(
                line.qty
                for line in db.query(SurplusAllocationLine)
                .filter(
                    SurplusAllocationLine.alloc_date == count_date,
                    SurplusAllocationLine.product_id == pid,
                )
                .all()
            )
            shop_received = max(0.0, surplus - explicitly_allocated)

        sc = ShopCount(
            count_date=count_date,
            product_id=pid,
            product_type="bread",
            yesterday_balance=prev_counts.get(pid, 0.0),
            received_today=shop_received,
            entered_balance=None,
            written_off_entered=0.0,
            calculated_sold=None,
            saved=0,
        )
        db.add(sc)
        rows.append(sc)

    db.commit()
    for r in rows:
        db.refresh(r)
    return rows


@router.put("/counts/{count_id}", response_model=ShopCountOut)
def update_count(count_id: int, body: ShopCountUpdate, db: Session = Depends(get_db)):
    sc = db.get(ShopCount, count_id)
    if not sc:
        raise HTTPException(status_code=404, detail="Рядок звірки не знайдено")
    if sc.saved:
        raise HTTPException(status_code=400, detail="Звірку вже підтверджено, редагування заблоковано")

    if body.entered_balance is not None:
        sc.entered_balance = body.entered_balance
    if body.written_off_entered is not None:
        sc.written_off_entered = body.written_off_entered
    if body.price is not None:
        sc.price = body.price

    # Авторозрахунок продано
    if sc.entered_balance is not None:
        sc.calculated_sold = max(
            0.0,
            sc.yesterday_balance + sc.received_today
            - sc.entered_balance - sc.written_off_entered,
        )

    db.commit()
    db.refresh(sc)
    return sc


@router.post("/counts/confirm")
def confirm_counts(count_date: str, db: Session = Depends(get_db)):
    """Підтверджує звірку на дату: фіналізує calculated_sold і ставить saved=1."""
    rows = db.query(ShopCount).filter(ShopCount.count_date == count_date).all()
    if not rows:
        raise HTTPException(status_code=404, detail="Звірку не ініціалізовано")

    for sc in rows:
        if sc.entered_balance is not None:
            sc.calculated_sold = max(
                0.0,
                sc.yesterday_balance + sc.received_today
                - sc.entered_balance - sc.written_off_entered,
            )
        sc.saved = 1

    db.commit()
    return {"confirmed": len(rows), "date": count_date}


# ─── Товари ІНШЕ ──────────────────────────────────────────────────────────────

@router.get("/other-products")
def list_other_products(db: Session = Depends(get_db)):
    return db.query(OtherProduct).filter(OtherProduct.is_active == 1).all()


@router.get("/stock-in")
def list_stock_in(stock_date: str, db: Session = Depends(get_db)):
    return (
        db.query(OtherStockIn)
        .filter(OtherStockIn.stock_date == stock_date)
        .all()
    )


@router.post("/stock-in", response_model=OtherStockInOut, status_code=201)
def create_stock_in(stock_date: str, data: OtherStockInCreate, db: Session = Depends(get_db)):
    from datetime import datetime
    s = OtherStockIn(
        stock_date=stock_date,
        **data.model_dump(),
        created_at=datetime.now().isoformat(),
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


@router.delete("/stock-in/{stock_in_id}", status_code=204)
def delete_stock_in(stock_in_id: int, db: Session = Depends(get_db)):
    s = db.get(OtherStockIn, stock_in_id)
    if not s:
        raise HTTPException(status_code=404, detail="Не знайдено")
    db.delete(s)
    db.commit()
