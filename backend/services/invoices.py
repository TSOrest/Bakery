"""Сервіс генерації номерів накладних."""

import logging

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from backend.models.invoices import Invoice

log = logging.getLogger(__name__)


def create_invoice_row(db: Session, *, retries: int = 6, **fields) -> Invoice:
    """Створює Invoice з унікальним номером, стійко до гонитви номерів.

    `generate_invoice_number` не атомарний: два одночасні запити можуть взяти
    однаковий MAX+1 і зіштовхнутись на UNIQUE(invoice_number). Тут вставка
    робиться у SAVEPOINT — при колізії відкочується ЛИШЕ ця вставка (не вся
    зовнішня транзакція з іншими рядками/накладними), номер перегенеровується
    і спроба повторюється.

    `invoice_date` обовʼязковий у fields. Повертає flushed Invoice (є inv.id).
    """
    date = fields.get("invoice_date")
    if not date:
        raise ValueError("invoice_date обовʼязковий для create_invoice")

    last_err: IntegrityError | None = None
    for attempt in range(retries):
        number = generate_invoice_number(db, date)
        inv = Invoice(invoice_number=number, **fields)
        try:
            with db.begin_nested():
                db.add(inv)
                db.flush()
            return inv
        except IntegrityError as exc:
            last_err = exc
            db.expunge(inv)
            if attempt < retries - 1:
                log.info("Колізія номера накладної %s, повтор (%d)", number, attempt + 1)
            continue

    assert last_err is not None
    raise last_err


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
