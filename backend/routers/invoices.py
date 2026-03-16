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
    db: Session = Depends(get_db),
):
    q = db.query(Invoice)
    if invoice_date:
        q = q.filter(Invoice.invoice_date == invoice_date)
    if client_id:
        q = q.filter(Invoice.client_id == client_id)
    return q.order_by(Invoice.invoice_number.desc()).all()


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
    db.commit()
    return {"id": invoice_id, "status": status}
