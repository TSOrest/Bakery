"""Бізнес-логіка фінансового модуля."""

from datetime import datetime
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.models.finances import Finance
from backend.models.references import Client
from backend.models.invoices import Invoice
from backend.schemas.finance import ClientBalance, FinanceSummary


def get_client_balance(db: Session, client_id: int, as_of: Optional[str] = None) -> float:
    """Повертає баланс клієнта станом на дату as_of (включно). Якщо None — всі записи."""
    q = db.query(func.sum(Finance.amount * Finance.sign)).filter(Finance.client_id == client_id)
    if as_of:
        q = q.filter(Finance.finance_date <= as_of)
    result = q.scalar()
    return round(result or 0.0, 2)


def get_all_balances(db: Session, as_of: Optional[str] = None) -> List[ClientBalance]:
    """Баланси всіх активних клієнтів станом на дату as_of."""
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
        balance = get_client_balance(db, c.id, as_of)

        q_pay = db.query(func.max(Finance.finance_date)).filter(
            Finance.client_id == c.id, Finance.finance_type == "payment"
        )
        q_inv = db.query(func.max(Finance.finance_date)).filter(
            Finance.client_id == c.id, Finance.finance_type == "invoice"
        )
        if as_of:
            q_pay = q_pay.filter(Finance.finance_date <= as_of)
            q_inv = q_inv.filter(Finance.finance_date <= as_of)

        result.append(ClientBalance(
            client_id         = c.id,
            client_name       = c.full_name,
            short_name        = c.short_name,
            route_id          = c.route_id,
            route_name        = routes.get(c.route_id) if c.route_id else None,
            balance           = balance,
            last_payment_date = q_pay.scalar(),
            last_invoice_date = q_inv.scalar(),
            client_kind       = c.client_kind or "customer",
        ))

    return result


def get_summary(db: Session, as_of: Optional[str] = None) -> FinanceSummary:
    """Загальна зведена статистика боргів станом на as_of — тільки по звичайних клієнтах."""
    balances = [b for b in get_all_balances(db, as_of) if b.client_kind == "customer"]

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
