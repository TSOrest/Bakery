"""Бізнес-логіка фінансового модуля."""

from datetime import datetime, date as _date, timedelta
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import func, case

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
    """Баланси всіх клієнтів (включно з деактивованими) станом на дату as_of.
    Деактивований клієнт може мати борг — він повинен відображатись у фінзвіті.
    Один GROUP BY запит замість 3 запитів на кожного клієнта.
    """
    from backend.models.references import Route

    clients = (
        db.query(Client)
        .order_by(Client.full_name)
        .all()
    )
    client_ids = [c.id for c in clients]

    routes = {r.id: r.name for r in db.query(Route).all()}

    # Один агрегований запит для балансів, останніх платежів і накладних
    fin_q = db.query(
        Finance.client_id,
        func.sum(Finance.amount * Finance.sign).label("balance"),
        func.max(
            case((Finance.finance_type == "payment", Finance.finance_date), else_=None)
        ).label("last_payment"),
        func.max(
            case((Finance.finance_type == "invoice", Finance.finance_date), else_=None)
        ).label("last_invoice"),
    ).filter(Finance.client_id.in_(client_ids))

    if as_of:
        fin_q = fin_q.filter(Finance.finance_date <= as_of)

    agg = {
        row.client_id: row
        for row in fin_q.group_by(Finance.client_id).all()
    }

    result = []
    for c in clients:
        row = agg.get(c.id)
        balance           = round(float(row.balance), 2) if row and row.balance is not None else 0.0
        last_payment_date = row.last_payment if row else None
        last_invoice_date = row.last_invoice if row else None

        result.append(ClientBalance(
            client_id         = c.id,
            client_name       = c.full_name,
            short_name        = c.short_name,
            route_id          = c.route_id,
            route_name        = routes.get(c.route_id) if c.route_id else None,
            balance           = balance,
            last_payment_date = last_payment_date,
            last_invoice_date = last_invoice_date,
            client_kind       = c.client_kind or "customer",
        ))

    return result


def get_summary(db: Session, as_of: Optional[str] = None) -> FinanceSummary:
    """Загальна зведена статистика боргів станом на as_of — тільки по звичайних клієнтах."""
    balances = [b for b in get_all_balances(db, as_of) if b.client_kind == "customer"]

    total_debt   = sum(b.balance for b in balances if b.balance < 0)
    total_credit = sum(b.balance for b in balances if b.balance > 0)

    today_d   = _date.fromisoformat(as_of) if as_of else _date.today()
    week_ago  = (today_d - timedelta(days=7)).isoformat()
    month_ago = (today_d - timedelta(days=30)).isoformat()
    today_s   = today_d.isoformat()

    income_types = ("payment", "deposit", "route_cash", "shop_revenue")
    income_7d = db.query(func.sum(Finance.amount)).filter(
        Finance.finance_date >= week_ago,
        Finance.finance_date <= today_s,
        Finance.sign == 1,
        Finance.finance_type.in_(income_types),
    ).scalar() or 0.0

    income_30d = db.query(func.sum(Finance.amount)).filter(
        Finance.finance_date >= month_ago,
        Finance.finance_date <= today_s,
        Finance.sign == 1,
        Finance.finance_type.in_(income_types),
    ).scalar() or 0.0

    return FinanceSummary(
        total_debt          = round(abs(total_debt), 2),
        total_credit        = round(total_credit, 2),
        net_balance         = round(total_credit + total_debt, 2),
        clients_in_debt     = sum(1 for b in balances if b.balance < 0),
        clients_with_credit = sum(1 for b in balances if b.balance > 0),
        income_7d           = round(income_7d, 2),
        income_30d          = round(income_30d, 2),
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
