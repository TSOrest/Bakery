"""Сервіс генерації номерів накладних та створення накладних."""

from sqlalchemy.orm import Session
from backend.models.invoices import Invoice


def generate_invoice_number(db: Session, date: str) -> str:
    """
    Генерує унікальний номер накладної у форматі YYYYMMDD-NNN.
    NNN скидається щодня. Приклад: 20260315-001.
    """
    date_compact = date.replace("-", "")
    prefix = f"{date_compact}-"

    # Знаходимо останній номер за цей день
    last = (
        db.query(Invoice)
        .filter(Invoice.invoice_number.like(f"{prefix}%"))
        .order_by(Invoice.invoice_number.desc())
        .first()
    )

    if last:
        seq = int(last.invoice_number.split("-")[-1]) + 1
    else:
        seq = 1

    return f"{prefix}{seq:03d}"
