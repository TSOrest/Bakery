"""Ендпоінти для накладних."""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
from backend.database import get_db
from backend.models.invoices import Invoice, InvoiceLine
from backend.schemas.invoices import InvoiceCreate, InvoiceOut
from backend.services.invoices import generate_invoice_number
from backend.services.prices import get_price

router = APIRouter(prefix="/invoices", tags=["Накладні"])


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
    return q.order_by(Invoice.invoice_number.desc()).all()


@router.post("/generate-from-orders")
def generate_from_orders(
    invoice_date: str,
    route_id: int,
    db: Session = Depends(get_db),
):
    """
    Автоматично генерує накладні на основі замовлень для всіх клієнтів маршруту.
    Пропускає клієнтів у яких вже є накладна за цю дату.
    Ціну бере через get_price() з урахуванням знижок і індивідуальних цін.
    """
    from backend.models.references import Client
    from backend.models.orders import Order

    clients = (
        db.query(Client)
        .filter(Client.route_id == route_id, Client.is_active == 1)
        .all()
    )

    created_count = skipped_count = no_orders_count = 0
    invoice_ids: list[int] = []

    for client in clients:
        orders = (
            db.query(Order)
            .filter(Order.client_id == client.id, Order.order_date == invoice_date)
            .all()
        )
        if not orders:
            no_orders_count += 1
            continue

        existing = (
            db.query(Invoice)
            .filter(Invoice.client_id == client.id, Invoice.invoice_date == invoice_date)
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
            route_id=route_id,
            created_at=datetime.now().isoformat(),
        )
        db.add(inv)
        db.flush()

        total = 0.0
        for order in orders:
            price = get_price(db, order.product_id, client.id, invoice_date)
            line_sum = round(order.qty * price, 2)
            total += line_sum
            db.add(InvoiceLine(
                invoice_id=inv.id,
                product_id=order.product_id,
                qty=order.qty,
                price=price,
                sum=line_sum,
            ))

        inv.total_sum = round(total, 2)
        db.flush()
        invoice_ids.append(inv.id)
        created_count += 1

    db.commit()
    return {
        "created":   created_count,
        "skipped":   skipped_count,
        "no_orders": no_orders_count,
        "invoice_ids": invoice_ids,
    }


@router.get("/{invoice_id}", response_model=InvoiceOut)
def get_invoice(invoice_id: int, db: Session = Depends(get_db)):
    inv = db.get(Invoice, invoice_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Накладну не знайдено")
    return inv


@router.post("/", response_model=InvoiceOut, status_code=201)
def create_invoice(data: InvoiceCreate, db: Session = Depends(get_db)):
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
    db.flush()  # щоб отримати inv.id

    total = 0.0
    for line_data in data.lines:
        # Ціна: override або автоматична
        unit_price = line_data.price_override if line_data.price_override else line_data.price
        line_sum = round(line_data.qty * unit_price, 2)
        total += line_sum

        line = InvoiceLine(
            invoice_id=inv.id,
            product_id=line_data.product_id,
            qty=line_data.qty,
            price=line_data.price,
            price_override=line_data.price_override,
            is_exchange=line_data.is_exchange,
            is_stale=line_data.is_stale,
            sum=line_sum,
        )
        db.add(line)

    inv.total_sum = round(total, 2)
    db.commit()
    db.refresh(inv)
    return inv


@router.post("/{invoice_id}/process-return")
def process_return(
    invoice_id: int,
    body: dict,
    db: Session = Depends(get_db),
):
    """
    Обробляє повернення після доставки:
    - Для кожного поверненого товару: додає рядок у shop_counts з product_type='stale'
    - Переводить накладну у статус 'delivered'
    """
    from backend.models.shop import ShopCount

    inv = db.get(Invoice, invoice_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Накладну не знайдено")
    if inv.status != "printed":
        raise HTTPException(status_code=400, detail="Накладна має бути у статусі 'printed'")

    for item in body.get("returns", []):
        qty   = float(item.get("returned", 0))
        pid   = int(item.get("productId", 0))
        price = item.get("stalePrice")  # може бути None

        if qty <= 0 or not pid:
            continue

        stale = (
            db.query(ShopCount)
            .filter(
                ShopCount.count_date  == inv.invoice_date,
                ShopCount.product_id  == pid,
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

    inv.status = "delivered"
    db.flush()

    # Автоматично створюємо фінансовий запис
    from backend.services.finance import create_invoice_finance_entry
    create_invoice_finance_entry(db, inv)

    db.commit()
    return {"id": invoice_id, "status": "delivered", "stale_added": len(body.get("returns", []))}


@router.put("/{invoice_id}/status")
def update_invoice_status(
    invoice_id: int,
    status: str,
    db: Session = Depends(get_db),
):
    inv = db.get(Invoice, invoice_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Накладну не знайдено")
    allowed = ("draft", "printed", "delivered", "cancelled")
    if status not in allowed:
        raise HTTPException(status_code=400, detail=f"Статус має бути один з: {allowed}")
    inv.status = status
    db.flush()

    if status == "delivered":
        from backend.services.finance import create_invoice_finance_entry
        create_invoice_finance_entry(db, inv)

    db.commit()
    return {"id": invoice_id, "status": status}
