"""Бізнес-логіка фінансового модуля."""

from datetime import datetime
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.models.finances import Finance
from backend.models.references import Client
from backend.models.invoices import Invoice
from backend.schemas.finance import ClientBalance, FinanceSummary


def get_client_balance(db: Session, client_id: int) -> float:
    """Повертає поточний баланс клієнта: додатне = кредит, від'ємне = борг."""
    result = (
        db.query(func.sum(Finance.amount * Finance.sign))
        .filter(Finance.client_id == client_id)
        .scalar()
    )
    return round(result or 0.0, 2)


def get_all_balances(db: Session) -> List[ClientBalance]:
    """Баланси всіх активних клієнтів."""
    from backend.models.references import Route

    clients = (
        db.query(Client)
        .filter(Client.is_active == 1)
        .order_by(Client.full_name)
        .all()
    )

    routes = {r.id: r.name for r in db.query(Route).all()}

    result = []
    for c in clients:
        balance = get_client_balance(db, c.id)

        last_payment = (
            db.query(func.max(Finance.finance_date))
            .filter(Finance.client_id == c.id, Finance.finance_type == "payment")
            .scalar()
        )
        last_invoice = (
            db.query(func.max(Finance.finance_date))
            .filter(Finance.client_id == c.id, Finance.finance_type == "invoice")
            .scalar()
        )

        result.append(ClientBalance(
            client_id         = c.id,
            client_name       = c.full_name,
            short_name        = c.short_name,
            route_id          = c.route_id,
            route_name        = routes.get(c.route_id) if c.route_id else None,
            balance           = balance,
            last_payment_date = last_payment,
            last_invoice_date = last_invoice,
            client_kind       = c.client_kind or "customer",
        ))

    return result


def get_summary(db: Session) -> FinanceSummary:
    """Загальна зведена статистика боргів — тільки по звичайних клієнтах (customer)."""
    balances = [b for b in get_all_balances(db) if b.client_kind == "customer"]

    total_debt   = sum(b.balance for b in balances if b.balance < 0)
    total_credit = sum(b.balance for b in balances if b.balance > 0)

    return FinanceSummary(
        total_debt          = round(abs(total_debt), 2),
        total_credit        = round(total_credit, 2),
        net_balance         = round(total_credit + total_debt, 2),
        clients_in_debt     = sum(1 for b in balances if b.balance < 0),
        clients_with_credit = sum(1 for b in balances if b.balance > 0),
    )


def create_invoice_finance_entry(db: Session, invoice: Invoice) -> None:
    """
    Створює запис у finances коли накладна переходить у статус delivered.
    Якщо запис вже існує — не дублює.
    """
    existing = (
        db.query(Finance)
        .filter(
            Finance.client_id    == invoice.client_id,
            Finance.finance_type == "invoice",
            Finance.notes        == invoice.invoice_number,
        )
        .first()
    )
    if existing:
        return

    entry = Finance(
        finance_date = invoice.invoice_date,
        client_id    = invoice.client_id,
        finance_type = "invoice",
        amount       = round(invoice.total_sum, 2),
        sign         = -1,
        notes        = invoice.invoice_number,
        created_at   = datetime.now().isoformat(),
        created_by   = "system",
    )
    db.add(entry)
