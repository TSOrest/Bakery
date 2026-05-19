"""Ендпоінти для замовлень."""

from collections import defaultdict
from typing import List, Optional, Dict
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, and_, or_
from sqlalchemy.orm import Session
from datetime import datetime, date, timedelta
from backend.database import get_db, safe_commit
from backend.models.orders import Order
from backend.models.invoices import Invoice
from backend.schemas.orders import (
    OrderCreate, OrderUpdate, OrderOut, TransferRequest, OrderWithChildrenOut,
    GridCell, GridExtraLine, GridResponse,
    BulkOrderUpsertRequest, BulkOrderUpsertResponse,
)
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


# ── Зведений вид (pivot grid) ────────────────────────────────────────────────


def _locked_client_ids(db: Session, order_date: str) -> List[int]:
    rows = (
        db.query(Invoice.client_id)
        .filter(Invoice.invoice_date == order_date, Invoice.status != "cancelled")
        .distinct()
        .all()
    )
    return [r[0] for r in rows]


def _is_base_row(o: Order) -> bool:
    """Базовий рядок — той що редагується через зведений вид."""
    if o.parent_order_id is not None:
        return False
    if o.origin_id is not None:
        # 0 = надлишок випічки, інше = переміщення з іншого замовлення
        return False
    if o.exchange_type not in (None, "none"):
        return False
    if o.price_override is not None:
        return False
    if o.source == "bot" and o.bot_status == "pending":
        return False
    return True


def _extra_kind(o: Order) -> str:
    if o.exchange_type not in (None, "none"):
        return "exchange"
    if o.price_override is not None:
        return "discount"
    if o.origin_id == 0:
        return "surplus"
    if o.parent_order_id is not None:
        return "transfer_in"
    return "other"


@router.get("/grid", response_model=GridResponse)
def orders_grid(order_date: str, db: Session = Depends(get_db)):
    """Матриця замовлень для зведеного виду (клієнти × вироби × дата)."""
    rows: List[Order] = (
        db.query(Order)
        .filter(Order.order_date == order_date)
        .all()
    )

    cells: Dict[int, Dict[int, GridCell]] = defaultdict(dict)

    def _get_cell(cid: int, pid: int) -> GridCell:
        c = cells[cid].get(pid)
        if c is None:
            c = GridCell()
            cells[cid][pid] = c
        return c

    for o in rows:
        cell = _get_cell(o.client_id, o.product_id)

        # Pending bot — не базовий і не extra, лише прапор
        if o.source == "bot" and o.bot_status == "pending":
            cell.has_pending_bot = True
            continue

        if _is_base_row(o):
            cell.qty = float(o.qty or 0)
            cell.base_order_id = o.id
            continue

        # Інакше — extra-рядок
        cell.extra_qty += float(o.qty or 0)
        cell.extra_count += 1
        cell.extra_lines.append(
            GridExtraLine(
                kind=_extra_kind(o),
                qty=float(o.qty or 0),
                price=o.price_override if o.price_override is not None else o.exchange_price,
            )
        )

    return GridResponse(
        order_date=order_date,
        locked_client_ids=_locked_client_ids(db, order_date),
        cells=cells,
    )


@router.post("/bulk-upsert", response_model=BulkOrderUpsertResponse)
def bulk_upsert_orders(
    data: BulkOrderUpsertRequest,
    db: Session = Depends(get_db),
    _=Depends(require_user),
):
    """Масове збереження базових замовлень із зведеного виду.

    Один POST для N клітинок: для кожного item шукаємо базовий рядок
    (parent IS NULL, exchange='none', price_override IS NULL, не pending-bot)
    і робимо UPDATE/DELETE/INSERT. Дочірні/обмін/знижка/pending-bot не зачіпаються.
    """
    if not data.items:
        return BulkOrderUpsertResponse()

    # Атомарна перевірка locked — якщо хоч один item стосується locked клієнта,
    # відмовляємо у всій транзакції з підказкою які саме.
    locked = set(_locked_client_ids(db, data.order_date))
    if locked:
        conflicting = sorted({it.client_id for it in data.items if it.client_id in locked})
        if conflicting:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Накладна вже сформована — клієнт заблокований для редагування",
                    "locked_client_ids": conflicting,
                },
            )

    # Один SELECT базових рядків на дату, проіндексованих за (client, product).
    existing_rows: List[Order] = (
        db.query(Order)
        .filter(
            Order.order_date == data.order_date,
            Order.parent_order_id.is_(None),
            Order.origin_id.is_(None),
            or_(Order.exchange_type.is_(None), Order.exchange_type == "none"),
            Order.price_override.is_(None),
            ~and_(Order.source == "bot", Order.bot_status == "pending"),
        )
        .all()
    )
    base_map: Dict[tuple, Order] = {(o.client_id, o.product_id): o for o in existing_rows}

    created = 0
    updated = 0
    deleted = 0
    now_iso = datetime.now().isoformat()

    for it in data.items:
        key = (it.client_id, it.product_id)
        existing = base_map.get(key)
        if it.qty <= 0:
            if existing is not None:
                db.delete(existing)
                deleted += 1
                del base_map[key]
            continue
        if existing is not None:
            if existing.qty != it.qty:
                existing.qty = it.qty
                updated += 1
        else:
            new_row = Order(
                client_id=it.client_id,
                product_id=it.product_id,
                qty=it.qty,
                order_date=data.order_date,
                source="phone",
                exchange_type="none",
                created_at=now_iso,
            )
            db.add(new_row)
            created += 1

    safe_commit(db, conflict_msg="Конфлікт при масовому збереженні замовлень")
    return BulkOrderUpsertResponse(created=created, updated=updated, deleted=deleted)


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
