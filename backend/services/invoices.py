"""Сервіс генерації номерів накладних."""

from sqlalchemy.orm import Session
from backend.models.invoices import Invoice


def generate_invoice_number(db: Session, date: str) -> str:
    """
    Генерує унікальний номер накладної у форматі YYYYMMDD-NNN.
    NNN скидається щодня. Приклад: 20260315-001.
    Коригуючі накладні (містять '/') виключаються з підрахунку.
    """
    date_compact = date.replace("-", "")
    prefix = f"{date_compact}-"

    last = (
        db.query(Invoice)
        .filter(
            Invoice.invoice_number.like(f"{prefix}%"),
            ~Invoice.invoice_number.contains("/"),
        )
        .order_by(Invoice.invoice_number.desc())
        .first()
    )

    if last:
        seq = int(last.invoice_number.split("-")[-1]) + 1
    else:
        seq = 1

    return f"{prefix}{seq:03d}"


def generate_corrective_number(db: Session, base_number: str) -> str:
    """
    Генерує номер коригуючої накладної у форматі YYYYMMDD-NNN/K.
    K починається з 1 і збільшується за наявності попередніх коригувань.
    Приклад: 20260315-001/1, 20260315-001/2, ...
    """
    last = (
        db.query(Invoice)
        .filter(Invoice.invoice_number.like(f"{base_number}/%"))
        .order_by(Invoice.invoice_number.desc())
        .first()
    )

    if last:
        version = int(last.invoice_number.split("/")[-1]) + 1
    else:
        version = 1

    return f"{base_number}/{version}"
