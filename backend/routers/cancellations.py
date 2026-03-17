"""Ендпоінти скасування рейсів."""

from datetime import datetime, date as date_type, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.cancellations import RouteCancellation, CancellationLine
from backend.models.invoices import Invoice
from backend.models.shop import ShopCount

router = APIRouter(prefix="/cancellations", tags=["Скасування рейсів"])


# ─── Схеми ───────────────────────────────────────────────────────────────────

class CancellationCreate(BaseModel):
    route_id:    int
    cancel_date: str
    reason:      Optional[str] = None


class DispositionLine(BaseModel):
    product_id:              int
    qty:                     float
    disposition:             str   # to_shop | to_next_day | writeoff
    next_day_price_override: Optional[float] = None


class FinalizeIn(BaseModel):
    lines: List[DispositionLine]


# ─── Ендпоінти ───────────────────────────────────────────────────────────────

@router.get("/")
def list_cancellations(
    cancel_date: str,
    route_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = db.query(RouteCancellation).filter(RouteCancellation.cancel_date == cancel_date)
    if route_id:
        q = q.filter(RouteCancellation.route_id == route_id)
    return q.all()


@router.post("/")
def create_cancellation(body: CancellationCreate, db: Session = Depends(get_db)):
    """
    Скасовує рейс:
    - Перевіряє чи вже не скасовано
    - Скасовує всі накладні маршруту за дату (статус → cancelled)
    - Створює запис RouteCancellation
    """
    existing = (
        db.query(RouteCancellation)
        .filter(
            RouteCancellation.route_id == body.route_id,
            RouteCancellation.cancel_date == body.cancel_date,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="Рейс вже скасовано")

    # Скасовуємо всі накладні маршруту за цю дату
    invoices = (
        db.query(Invoice)
        .filter(
            Invoice.route_id == body.route_id,
            Invoice.invoice_date == body.cancel_date,
            Invoice.status != "cancelled",
        )
        .all()
    )
    for inv in invoices:
        inv.status = "cancelled"

    canc = RouteCancellation(
        route_id=body.route_id,
        cancel_date=body.cancel_date,
        reason=body.reason,
        created_at=datetime.now().isoformat(),
    )
    db.add(canc)
    db.commit()
    db.refresh(canc)
    return {"id": canc.id, "cancelled_invoices": len(invoices)}


@router.post("/{cancellation_id}/finalize")
def finalize_cancellation(
    cancellation_id: int,
    body: FinalizeIn,
    db: Session = Depends(get_db),
):
    """
    Застосовує розподіл товарів після скасування рейсу:
    - to_shop:    додає у shop_counts як stale (несвіжий) цього дня
    - to_next_day: додає у shop_counts наступного дня як received_today
    - writeoff:   лише записує рядок (товар списано)
    """
    canc = db.get(RouteCancellation, cancellation_id)
    if not canc:
        raise HTTPException(status_code=404, detail="Скасування не знайдено")

    # Видаляємо старі рядки якщо є (повторна фіналізація)
    for old in db.query(CancellationLine).filter(CancellationLine.cancellation_id == cancellation_id).all():
        db.delete(old)

    next_date = (date_type.fromisoformat(canc.cancel_date) + timedelta(days=1)).isoformat()

    for item in body.lines:
        if item.qty <= 0:
            continue

        # Зберігаємо рядок
        db.add(CancellationLine(
            cancellation_id=cancellation_id,
            product_id=item.product_id,
            qty=item.qty,
            disposition=item.disposition,
            next_day_price_override=item.next_day_price_override,
        ))

        if item.disposition == "to_shop":
            _add_to_shop(db, canc.cancel_date, item.product_id, item.qty, product_type="stale")

        elif item.disposition == "to_next_day":
            _add_to_shop(db, next_date, item.product_id, item.qty, product_type="bread")

        # writeoff: тільки запис у CancellationLine

    db.commit()
    return {"finalized": True, "cancellation_id": cancellation_id, "lines": len(body.lines)}


def _add_to_shop(
    db: Session, count_date: str, product_id: int, qty: float, product_type: str
) -> None:
    """Додає кількість у received_today відповідного рядка shop_counts (або створює новий)."""
    sc = (
        db.query(ShopCount)
        .filter(
            ShopCount.count_date   == count_date,
            ShopCount.product_id   == product_id,
            ShopCount.product_type == product_type,
        )
        .first()
    )
    if sc:
        sc.received_today += qty
    else:
        db.add(ShopCount(
            count_date          = count_date,
            product_id          = product_id,
            product_type        = product_type,
            yesterday_balance   = 0.0,
            received_today      = qty,
            written_off_entered = 0.0,
            saved               = 0,
        ))
