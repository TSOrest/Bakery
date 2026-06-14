"""Ендпоінти для накладних."""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from datetime import datetime
from backend.database import get_db, safe_commit
from backend.models.invoices import Invoice, InvoiceLine, InvoiceTransfer
from backend.models.references import Client
from backend.schemas.invoices import (
    InvoiceCreate, InvoiceOut, InvoiceTransferCreate, InvoiceTransferOut,
    InvoiceLinesUpdate, ProcessingUpdate, AcceptBody,
)
from backend.services.invoices import generate_invoice_number, generate_corrective_number
from backend.services.prices import get_price
from backend.services.finance import recompute_invoice_finance
from backend.routers.auth import require_user

router = APIRouter(prefix="/invoices", tags=["Накладні"])

# Допустимі переходи статусів
_TRANSITIONS = {
    "draft":      {"sent", "cancelled"},
    "sent":       {"processing", "accepted", "cancelled"},
    "processing": {"accepted", "cancelled"},
    "accepted":   set(),
    "cancelled":  set(),
}


@router.get("/", response_model=List[InvoiceOut])
def list_invoices(
    invoice_date: Optional[str] = None,
    client_id: Optional[int] = None,
    route_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Invoice)
    if invoice_date:
        q = q.filter(Invoice.invoice_date == invoice_date)
    if client_id:
        q = q.filter(Invoice.client_id == client_id)
    if route_id:
        q = q.filter(Invoice.route_id == route_id)
    return q.order_by(Invoice.invoice_number).all()


@router.get("/locked-clients")
def get_locked_clients(date: str, db: Session = Depends(get_db)):
    """Повертає client_ids, для яких є не скасована накладна на дату."""
    rows = (
        db.query(Invoice.client_id)
        .filter(Invoice.invoice_date == date, Invoice.status != "cancelled")
        .distinct()
        .all()
    )
    return [r[0] for r in rows]


@router.post("/generate-from-orders")
def generate_from_orders(
    invoice_date: str,
    route_id: Optional[int] = None,
    client_id: Optional[int] = None,
    initial_status: str = "sent",
    db: Session = Depends(get_db),
    _=Depends(require_user),
):
    """
    Генерує накладні на основі замовлень.
    - route_id: для всіх клієнтів маршруту
    - client_id: для одного клієнта (режим "Відправити" з UI)
    - initial_status: статус накладної після створення (за замовч. 'sent')
    Пропускає клієнтів у яких вже є накладна за цю дату.
    Ціну бере через get_price() з урахуванням знижок і індивідуальних цін.
    Враховує переміщення (parent_order_id): effective_qty = order.qty - transferred_out.
    """
    from backend.models.references import Client
    from backend.models.orders import Order

    if not route_id and not client_id:
        raise HTTPException(status_code=400, detail="Потрібен route_id або client_id")

    if client_id:
        client_obj = db.get(Client, client_id)
        if not client_obj:
            raise HTTPException(status_code=404, detail="Клієнта не знайдено")
        clients = [client_obj]
        eff_route_id = client_obj.route_id
    else:
        clients = (
            db.query(Client)
            .filter(Client.route_id == route_id, Client.is_active == 1)
            .all()
        )
        eff_route_id = route_id

    created_count = skipped_count = no_orders_count = 0
    invoice_ids: list[int] = []

    for client in clients:
        # Батьківські замовлення клієнта
        parent_orders = (
            db.query(Order)
            .filter(
                Order.client_id == client.id,
                Order.order_date == invoice_date,
                Order.parent_order_id.is_(None),
                (Order.origin_id.is_(None) | (Order.origin_id == 0)),
                Order.bot_status.isnot("pending"),
            )
            .all()
        )

        # Переміщення, отримані від інших клієнтів (дочірні рядки з origin_id != null)
        transfer_in_orders = (
            db.query(Order)
            .filter(
                Order.client_id == client.id,
                Order.order_date == invoice_date,
                Order.parent_order_id.isnot(None),
                Order.origin_id.isnot(None),
            )
            .all()
        )

        # Підраховуємо ефективні кількості з урахуванням переміщень
        effective_orders = []
        for order in parent_orders:
            transferred_out = (
                db.query(func.coalesce(func.sum(Order.qty), 0.0))
                .filter(Order.parent_order_id == order.id, Order.client_id != client.id)
                .scalar()
            ) or 0.0
            eff_qty = order.qty - transferred_out
            if eff_qty > 0:
                effective_orders.append((order, eff_qty))

        if not effective_orders and not transfer_in_orders:
            no_orders_count += 1
            continue

        existing = (
            db.query(Invoice)
            .filter(
                Invoice.client_id == client.id,
                Invoice.invoice_date == invoice_date,
                Invoice.corrective_for_id.is_(None),
            )
            .first()
        )
        if existing:
            skipped_count += 1
            invoice_ids.append(existing.id)
            continue

        number = generate_invoice_number(db, invoice_date)
        inv = Invoice(
            invoice_number=number,
            invoice_date=invoice_date,
            client_id=client.id,
            route_id=eff_route_id,
            status=initial_status,
            created_at=datetime.now().isoformat(),
        )
        db.add(inv)
        db.flush()

        total = 0.0
        for order, eff_qty in effective_orders:
            if order.exchange_type == "pre_order":
                db.add(InvoiceLine(
                    invoice_id=inv.id,
                    product_id=order.product_id,
                    qty=eff_qty,
                    price=0.0,
                    is_exchange=1,
                    sum=0.0,
                ))
            else:
                price = get_price(db, order.product_id, client.id, invoice_date)
                effective_price = order.price_override if order.price_override is not None else price
                line_sum = round(eff_qty * effective_price, 2)
                total += line_sum
                db.add(InvoiceLine(
                    invoice_id=inv.id,
                    product_id=order.product_id,
                    qty=eff_qty,
                    price=price,
                    price_override=order.price_override,
                    sum=line_sum,
                ))

        # Рядки з переміщень від інших клієнтів
        for order in transfer_in_orders:
            price = get_price(db, order.product_id, client.id, invoice_date)
            effective_price = order.price_override if order.price_override is not None else price
            line_sum = round(order.qty * effective_price, 2)
            total += line_sum
            db.add(InvoiceLine(
                invoice_id=inv.id,
                product_id=order.product_id,
                qty=order.qty,
                price=price,
                price_override=order.price_override,
                sum=line_sum,
            ))

        inv.total_sum = round(total, 2)
        db.flush()
        invoice_ids.append(inv.id)
        created_count += 1

    safe_commit(db)
    return {
        "created":    created_count,
        "skipped":    skipped_count,
        "no_orders":  no_orders_count,
        "invoice_ids": invoice_ids,
    }


def _client_label(db: Session, client_id: int) -> str:
    c = db.get(Client, client_id)
    return (c.short_name or c.full_name) if c else f"#{client_id}"


def _build_transfers(db: Session, invoice_id: int) -> List[InvoiceTransferOut]:
    """Переміщення для накладної з напрямком (out/in) і назвою контрагента."""
    rows = (
        db.query(InvoiceTransfer)
        .filter(
            (InvoiceTransfer.source_invoice_id == invoice_id)
            | (InvoiceTransfer.target_invoice_id == invoice_id)
        )
        .order_by(InvoiceTransfer.id)
        .all()
    )
    out: List[InvoiceTransferOut] = []
    for t in rows:
        is_out = t.source_invoice_id == invoice_id
        other_inv_id = t.target_invoice_id if is_out else t.source_invoice_id
        other_inv = db.get(Invoice, other_inv_id)
        item = InvoiceTransferOut.model_validate(t)
        item.direction = "out" if is_out else "in"
        item.counterparty_name = _client_label(db, other_inv.client_id) if other_inv else "—"
        out.append(item)
    return out


@router.get("/{invoice_id}", response_model=InvoiceOut)
def get_invoice(invoice_id: int, db: Session = Depends(get_db)):
    inv = db.get(Invoice, invoice_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Накладну не знайдено")
    out = InvoiceOut.model_validate(inv)
    out.transfers = _build_transfers(db, invoice_id)
    return out


@router.post("/", response_model=InvoiceOut, status_code=201)
def create_invoice(data: InvoiceCreate, db: Session = Depends(get_db), _=Depends(require_user)):
    number = generate_invoice_number(db, data.invoice_date)

    inv = Invoice(
        invoice_number=number,
        invoice_date=data.invoice_date,
        client_id=data.client_id,
        route_id=data.route_id,
        notes=data.notes,
        created_at=datetime.now().isoformat(),
    )
    db.add(inv)
    db.flush()

    total = 0.0
    for line_data in data.lines:
        unit_price = line_data.price_override if line_data.price_override else line_data.price
        line_sum = round(line_data.qty * unit_price, 2)
        total += line_sum

        db.add(InvoiceLine(
            invoice_id=inv.id,
            product_id=line_data.product_id,
            qty=line_data.qty,
            price=line_data.price,
            price_override=line_data.price_override,
            is_exchange=line_data.is_exchange,
            is_stale=line_data.is_stale,
            sum=line_sum,
        ))

    inv.total_sum = round(total, 2)
    safe_commit(db)
    db.refresh(inv)
    return inv


@router.put("/{invoice_id}/lines", response_model=InvoiceOut)
def update_invoice_lines(
    invoice_id: int,
    data: InvoiceLinesUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_user),
):
    """Оновлює кількості (і опц. price_override) рядків накладної.

    Дозволено у draft/sent/processing/accepted. Перераховує total_sum.
    Для accepted — синхронізує фінансовий борг-запис (recompute_invoice_finance).
    """
    inv = db.get(Invoice, invoice_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Накладну не знайдено")
    if inv.status == "cancelled":
        raise HTTPException(status_code=400, detail="Скасовану накладну не можна редагувати")

    for upd in data.lines:
        line = db.get(InvoiceLine, upd.id)
        if not line or line.invoice_id != invoice_id:
            continue
        line.qty = upd.qty
        if upd.price_override is not None:
            line.price_override = upd.price_override
        effective = line.price_override if line.price_override is not None else line.price
        line.sum = round(upd.qty * effective, 2)

    inv.total_sum = _recalc_total(inv)
    recompute_invoice_finance(db, inv)
    safe_commit(db)
    db.refresh(inv)
    out = InvoiceOut.model_validate(inv)
    out.transfers = _build_transfers(db, invoice_id)
    return out


def _recalc_total(inv: Invoice) -> float:
    """Сума всіх неробмінних рядків накладної."""
    return round(sum(l.sum for l in inv.lines if not l.is_exchange), 2)


def _resolve_or_create_invoice(db: Session, client_id: int, date: str, route_id: Optional[int]) -> Invoice:
    """Знайти не-cancelled накладну клієнта на дату або створити нову (status='sent')."""
    inv = (
        db.query(Invoice)
        .filter(
            Invoice.client_id == client_id,
            Invoice.invoice_date == date,
            Invoice.status != "cancelled",
            Invoice.corrective_for_id.is_(None),
        )
        .order_by(Invoice.id)
        .first()
    )
    if inv:
        return inv
    client = db.get(Client, client_id)
    inv = Invoice(
        invoice_number=generate_invoice_number(db, date),
        invoice_date=date,
        client_id=client_id,
        route_id=route_id if route_id is not None else (client.route_id if client else None),
        status="sent",
        total_sum=0.0,
        created_at=datetime.now().isoformat(),
    )
    db.add(inv)
    db.flush()
    return inv


@router.post("/{invoice_id}/transfer", response_model=InvoiceOut)
def transfer_invoice_line(
    invoice_id: int,
    data: InvoiceTransferCreate,
    db: Session = Depends(get_db),
    _=Depends(require_user),
):
    """Перемістити товар з цієї накладної на іншого клієнта / магазин / систему.

    Джерело: рядок product_id зменшується на qty (total_sum ↓).
    Ціль: накладна клієнта на ту ж дату (створюється якщо нема) — рядок
    product_id збільшується/додається (ціна через get_price, total_sum ↑).
    Власний магазин (shop) → ціль-накладна accepted (товар у POS), без боргу.
    Фінанси обох накладних синхронізуються (recompute_invoice_finance).
    Записується InvoiceTransfer для анотацій.
    """
    src = db.get(Invoice, invoice_id)
    if not src:
        raise HTTPException(status_code=404, detail="Накладну не знайдено")
    if src.status == "cancelled":
        raise HTTPException(status_code=400, detail="Скасовану накладну не можна коригувати")
    if data.to_client_id == src.client_id:
        raise HTTPException(status_code=400, detail="Не можна переміщати самому собі")

    src_line = next((l for l in src.lines if l.product_id == data.product_id and not l.is_exchange), None)
    if not src_line:
        raise HTTPException(status_code=400, detail="У накладній немає цього виробу")
    if data.qty <= 0 or data.qty > src_line.qty + 1e-9:
        raise HTTPException(
            status_code=400,
            detail=f"Кількість має бути 0 < qty ≤ {src_line.qty:g}",
        )

    target_client = db.get(Client, data.to_client_id)
    if not target_client:
        raise HTTPException(status_code=404, detail="Цільового клієнта не знайдено")
    is_shop = (target_client.client_kind == "shop") or (target_client.is_own_shop == 1)

    # 1. Джерело: зменшити рядок
    src_line.qty = round(src_line.qty - data.qty, 4)
    src_eff = src_line.price_override if src_line.price_override is not None else src_line.price
    src_line.sum = round(src_line.qty * src_eff, 2)
    src.total_sum = _recalc_total(src)

    # 2. Ціль: знайти/створити накладну + рядок
    tgt = _resolve_or_create_invoice(db, data.to_client_id, src.invoice_date, src.route_id)
    tgt_line = next((l for l in tgt.lines if l.product_id == data.product_id and not l.is_exchange), None)
    if tgt_line:
        tgt_line.qty = round(tgt_line.qty + data.qty, 4)
        eff = tgt_line.price_override if tgt_line.price_override is not None else tgt_line.price
        tgt_line.sum = round(tgt_line.qty * eff, 2)
    else:
        price = get_price(db, data.product_id, data.to_client_id, src.invoice_date)
        # append у relationship-колекцію (не db.refresh — щоб не стерти зміни)
        tgt.lines.append(InvoiceLine(
            invoice_id=tgt.id,
            product_id=data.product_id,
            qty=data.qty,
            price=price,
            price_override=None,
            is_exchange=0,
            is_stale=0,
            sum=round(data.qty * price, 2),
        ))
    tgt.total_sum = _recalc_total(tgt)

    # 3. Магазин — товар одразу у POS: accepted-накладна, без боргу
    if is_shop and tgt.status != "accepted":
        tgt.status = "accepted"

    # 4. Леджер переміщення
    db.add(InvoiceTransfer(
        transfer_date=src.invoice_date,
        source_invoice_id=src.id,
        target_invoice_id=tgt.id,
        product_id=data.product_id,
        qty=data.qty,
        notes=data.notes,
        created_at=datetime.now().isoformat(),
        created_by="operator",
    ))

    # 5. Фінанси обох накладних
    recompute_invoice_finance(db, src)
    recompute_invoice_finance(db, tgt)

    safe_commit(db)
    db.refresh(src)
    out = InvoiceOut.model_validate(src)
    out.transfers = _build_transfers(db, src.id)
    return out


@router.put("/{invoice_id}/status", response_model=InvoiceOut)
def update_invoice_status(
    invoice_id: int,
    status: str,
    body: AcceptBody = AcceptBody(),
    db: Session = Depends(get_db),
    _=Depends(require_user),
):
    """
    Переводить накладну у новий статус.
    draft → sent: заморожує (lines вже є), повертає should_print=True у полі notes (frontend обробляє)
    sent/processing → accepted: створює фінансовий запис (борг) + оплату якщо payment_amount > 0
    """
    inv = db.get(Invoice, invoice_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Накладну не знайдено")

    allowed = _TRANSITIONS.get(inv.status, set())
    if status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Перехід {inv.status!r} → {status!r} недозволений",
        )

    inv.status = status

    if status == "accepted":
        from backend.services.finance import create_invoice_finance_entry, create_payment_finance_entry
        create_invoice_finance_entry(db, inv)
        if body.payment_amount > 0:
            create_payment_finance_entry(db, inv, body.payment_amount)

    safe_commit(db)
    db.refresh(inv)

    if status == "sent":
        try:
            from backend.services.telegram_bot import send_invoice_pdf_to_client
            send_invoice_pdf_to_client(db, inv)
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning("Telegram invoice send failed: %s", exc)

    return inv


@router.post("/{invoice_id}/corrective", response_model=InvoiceOut)
def create_corrective_invoice(
    invoice_id: int,
    data: ProcessingUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_user),
):
    """
    Завершує Опрацювання:
    - Якщо є відхилення від оригіналу → створює коригуючу накладну (YYYYMMDD-NNN/1)
    - Переводить оригінальну накладну в accepted
    - Записує cash_received як фінансовий запис (готівка від водія)
    """
    inv = db.get(Invoice, invoice_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Накладну не знайдено")
    if inv.status not in ("sent", "processing"):
        raise HTTPException(
            status_code=400,
            detail="Коригування доступне тільки в статусі sent або processing",
        )

    # Перевіряємо чи є відхилення
    has_diff = False
    corr_lines = []
    for corr_in in data.lines:
        orig = next((l for l in inv.lines if l.product_id == corr_in.product_id), None)
        if not orig:
            continue
        diff = round(orig.qty - corr_in.qty_delivered, 4)
        if abs(diff) > 0.001:
            has_diff = True
            price = corr_in.price_override if corr_in.price_override is not None else orig.price
            corr_lines.append({
                "product_id": corr_in.product_id,
                "qty": diff,        # позитивне = повернення, негативне = додача
                "price": price,
                "sum": round(diff * price, 2),
            })

    corr_inv = None
    if has_diff:
        corr_number = generate_corrective_number(db, inv.invoice_number)
        corr_inv = Invoice(
            invoice_number=corr_number,
            invoice_date=inv.invoice_date,
            route_id=inv.route_id,
            client_id=inv.client_id,
            status="accepted",
            corrective_for_id=inv.id,
            notes=data.notes,
            created_at=datetime.now().isoformat(),
        )
        db.add(corr_inv)
        db.flush()

        total = 0.0
        for cl in corr_lines:
            total += cl["sum"]
            db.add(InvoiceLine(
                invoice_id=corr_inv.id,
                product_id=cl["product_id"],
                qty=cl["qty"],
                price=cl["price"],
                sum=cl["sum"],
            ))
        corr_inv.total_sum = round(total, 2)

    # Приймаємо оригінальну накладну
    inv.status = "accepted"

    from backend.services.finance import create_invoice_finance_entry, create_payment_finance_entry
    create_invoice_finance_entry(db, inv)

    # Фіксуємо оплату клієнта (нове поле) або готівку від водія (legacy)
    payment = data.payment_amount if data.payment_amount > 0 else (data.cash_received or 0.0)
    if payment > 0:
        create_payment_finance_entry(db, inv, payment)

    safe_commit(db)
    if corr_inv:
        db.refresh(corr_inv)
        return corr_inv

    db.refresh(inv)
    return inv


@router.post("/{invoice_id}/process-return")
def process_return(
    invoice_id: int,
    body: dict,
    db: Session = Depends(get_db),
    _=Depends(require_user),
):
    """
    Застарілий ендпоінт — залишається для сумісності.
    Рекомендовано використовувати POST /{id}/corrective.
    """
    from backend.models.shop import ShopCount

    inv = db.get(Invoice, invoice_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Накладну не знайдено")
    if inv.status not in ("sent", "processing"):
        raise HTTPException(status_code=400, detail="Накладна має бути у статусі sent або processing")

    for item in body.get("returns", []):
        qty   = float(item.get("returned", 0))
        pid   = int(item.get("productId", 0))
        price = item.get("stalePrice")

        if qty <= 0 or not pid:
            continue

        stale = (
            db.query(ShopCount)
            .filter(
                ShopCount.count_date   == inv.invoice_date,
                ShopCount.product_id   == pid,
                ShopCount.product_type == "stale",
            )
            .first()
        )
        if stale:
            stale.received_today += qty
            if price is not None:
                stale.price = float(price)
        else:
            stale = ShopCount(
                count_date          = inv.invoice_date,
                product_id          = pid,
                product_type        = "stale",
                yesterday_balance   = 0.0,
                received_today      = qty,
                written_off_entered = 0.0,
                price               = float(price) if price is not None else None,
                saved               = 0,
            )
            db.add(stale)

    inv.status = "accepted"

    from backend.services.finance import create_invoice_finance_entry
    create_invoice_finance_entry(db, inv)

    safe_commit(db)
    return {"id": invoice_id, "status": "accepted"}
