"""Ендпоінти фінансового модуля."""

from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db, safe_commit
from backend.models.finances import Finance
from backend.models.shop import ShopCount
from backend.models.references import Client
from backend.services.prices import get_price
from backend.models.finances import FinanceArticle
from backend.schemas.finance import (
    FinanceCreate, FinanceUpdate, FinanceOut, ClientBalance, FinanceSummary, FINANCE_LABELS,
)
from backend.services.finance import get_all_balances, get_summary
from backend.routers.auth import require_user

router = APIRouter(prefix="/finances", tags=["Фінанси"])


def _enrich(
    entry: Finance,
    clients: dict,
    articles: dict,
) -> FinanceOut:
    """Додає client_name, type_label, article_name, signed_amount до запису."""
    c = clients.get(entry.client_id) if entry.client_id else None
    client_name = (c.short_name or c.full_name) if c else None

    a = articles.get(entry.article_id) if entry.article_id else None
    article_name = a.name if a else None

    type_label = article_name or FINANCE_LABELS.get(entry.finance_type, entry.finance_type)

    return FinanceOut(
        id            = entry.id,
        finance_date  = entry.finance_date,
        client_id     = entry.client_id,
        client_name   = client_name,
        finance_type  = entry.finance_type,
        type_label    = type_label,
        article_id    = entry.article_id,
        article_name  = article_name,
        amount        = entry.amount,
        sign          = entry.sign,
        signed_amount = round(entry.amount * entry.sign, 2),
        notes         = entry.notes,
        created_at    = entry.created_at,
        created_by    = entry.created_by,
    )


def _batch_enrich(entries: list, db: Session) -> list[FinanceOut]:
    """Batch-збагачення списку Finance-записів: 2 запити замість 2N."""
    client_ids  = {e.client_id  for e in entries if e.client_id}
    article_ids = {e.article_id for e in entries if e.article_id}

    clients  = {c.id: c for c in db.query(Client).filter(Client.id.in_(client_ids)).all()} if client_ids else {}
    articles = {a.id: a for a in db.query(FinanceArticle).filter(FinanceArticle.id.in_(article_ids)).all()} if article_ids else {}

    return [_enrich(e, clients, articles) for e in entries]


# ── Список операцій ────────────────────────────────────────────────────────────

@router.get("/", response_model=List[FinanceOut])
def list_finances(
    client_id:    Optional[int] = None,
    date_from:    Optional[str] = None,
    date_to:      Optional[str] = None,
    finance_type: Optional[str] = None,
    article_id:   Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Finance)
    if client_id:
        q = q.filter(Finance.client_id == client_id)
    if date_from:
        q = q.filter(Finance.finance_date >= date_from)
    if date_to:
        q = q.filter(Finance.finance_date <= date_to)
    if finance_type:
        q = q.filter(Finance.finance_type == finance_type)
    if article_id:
        q = q.filter(Finance.article_id == article_id)
    entries = q.order_by(Finance.finance_date.desc(), Finance.id.desc()).all()
    return _batch_enrich(entries, db)


# ── Баланси клієнтів ──────────────────────────────────────────────────────────

@router.get("/balances", response_model=List[ClientBalance])
def balances(date: Optional[str] = None, db: Session = Depends(get_db)):
    return get_all_balances(db, as_of=date)


@router.get("/summary", response_model=FinanceSummary)
def summary(date: Optional[str] = None, db: Session = Depends(get_db)):
    return get_summary(db, as_of=date)


@router.get("/internal-kpi")
def internal_kpi(date: str, db: Session = Depends(get_db)):
    """KPI-картки для внутрішніх клієнтів: магазин, пайок, списання."""
    from backend.models.orders import Order

    # Системні клієнти (пайок, списання, магазин)
    system_clients: dict[int, Client] = {
        c.id: c for c in db.query(Client).filter(
            Client.client_kind.in_(["ration", "writeoff", "shop"])
        ).all()
    }

    # Замовлення для системних клієнтів за дату (будь-який origin_id)
    system_orders = db.query(Order).filter(
        Order.order_date == date,
        Order.client_id.in_(list(system_clients.keys())),
    ).all()

    product_ids = {o.product_id for o in system_orders}
    price_map: dict[int, float] = {
        pid: get_price(db, pid, None, date)
        for pid in product_ids
    }

    ration_amount = 0.0
    writeoff_amount = 0.0
    shop_received = 0.0
    for o in system_orders:
        client = system_clients.get(o.client_id)
        if not client:
            continue
        amount = o.qty * price_map.get(o.product_id, 0.0)
        if client.client_kind == 'ration':
            ration_amount += amount
        elif client.client_kind == 'writeoff':
            writeoff_amount += amount
        elif client.client_kind == 'shop':
            shop_received += amount

    # Фінансові списання за дату (магазин, стаття "Списання")
    writeoff_article = db.query(FinanceArticle).filter(
        FinanceArticle.name == 'Списання'
    ).first()
    if writeoff_article:
        writeoff_amount += sum(
            f.amount for f in db.query(Finance).filter(
                Finance.finance_date == date,
                Finance.article_id == writeoff_article.id,
            ).all()
        )

    # Магазин — залишок зі shop_counts (entered_balance × price)
    shop_counts = db.query(ShopCount).filter(ShopCount.count_date == date).all()
    stock_value = sum((sc.entered_balance or 0) * (sc.price or 0) for sc in shop_counts)

    # Магазин — виручка (оплати від клієнтів типу shop за дату)
    shop_ids = [c_id for c_id, c in system_clients.items() if c.client_kind == 'shop']
    revenue = 0.0
    if shop_ids:
        revenue = sum(
            f.amount for f in db.query(Finance).filter(
                Finance.finance_date == date,
                Finance.client_id.in_(shop_ids),
                Finance.sign == 1,
            ).all()
        )

    return {
        "shop":     {"stock_value": round(stock_value, 2), "received_value": round(shop_received, 2), "revenue": round(revenue, 2)},
        "ration":   {"amount": round(ration_amount, 2)},
        "writeoff": {"amount": round(writeoff_amount, 2)},
    }


@router.get("/client/{client_id}", response_model=List[FinanceOut])
def client_history(
    client_id: int,
    date_from: Optional[str] = None,
    date_to:   Optional[str] = None,
    db: Session = Depends(get_db),
):
    if not db.get(Client, client_id):
        raise HTTPException(status_code=404, detail="Клієнта не знайдено")

    q = db.query(Finance).filter(Finance.client_id == client_id)
    if date_from:
        q = q.filter(Finance.finance_date >= date_from)
    if date_to:
        q = q.filter(Finance.finance_date <= date_to)

    entries = q.order_by(Finance.finance_date.desc(), Finance.id.desc()).all()
    return _batch_enrich(entries, db)


# ── Додавання операцій ─────────────────────────────────────────────────────────

@router.post("/", response_model=FinanceOut, status_code=201)
def create_finance(data: FinanceCreate, db: Session = Depends(get_db), _=Depends(require_user)):
    # Перевірка: чи потрібен client_id для цієї операції
    if data.article_id:
        # Нова логіка: визначаємо за needs_client статті
        article = db.get(FinanceArticle, data.article_id)
        needs_client = bool(article and article.needs_client == 1)
    else:
        # Legacy: визначаємо за finance_type
        client_required = {"invoice", "payment", "writeoff", "exchange_credit"}
        needs_client = data.finance_type in client_required

    if needs_client and not data.client_id:
        raise HTTPException(
            status_code=422,
            detail="Ця стаття потребує вказання клієнта",
        )
    if data.client_id and not db.get(Client, data.client_id):
        raise HTTPException(status_code=404, detail="Клієнта не знайдено")

    entry = Finance(
        finance_date = data.finance_date,
        client_id    = data.client_id,
        finance_type = data.finance_type,
        article_id   = data.article_id,
        amount       = data.amount,
        sign         = data.sign,
        notes        = data.notes,
        created_at   = datetime.now().isoformat(),
        created_by   = data.created_by,
    )
    db.add(entry)
    safe_commit(db)
    db.refresh(entry)
    return _batch_enrich([entry], db)[0]


# ── Редагування суми ──────────────────────────────────────────────────────────

@router.patch("/{finance_id}", response_model=FinanceOut)
def update_finance(
    finance_id: int,
    data: FinanceUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_user),
):
    """Редагування суми і нотатки фінансового запису.

    Дозволено лише якщо:
    - стаття має editable=1;
    - запис створено вручну (created_by != 'system') — автоматичні від накладних не торкаємось.

    Перевірку дати робить frontend (показує кнопку лише для finance_date == workDate).
    """
    entry = db.get(Finance, finance_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Запис не знайдено")

    if entry.created_by == "system":
        raise HTTPException(
            status_code=400,
            detail="Автоматичний запис не можна редагувати вручну",
        )

    article = db.get(FinanceArticle, entry.article_id) if entry.article_id else None
    if not article or (article.editable or 0) != 1:
        raise HTTPException(
            status_code=400,
            detail="Для цієї статті редагування суми не дозволено",
        )

    entry.amount = data.amount
    if data.notes is not None:
        entry.notes = data.notes
    safe_commit(db)
    db.refresh(entry)
    return _batch_enrich([entry], db)[0]


# ── Видалення ─────────────────────────────────────────────────────────────────

@router.delete("/{finance_id}", status_code=204)
def delete_finance(finance_id: int, db: Session = Depends(get_db), _=Depends(require_user)):
    entry = db.get(Finance, finance_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Запис не знайдено")
    # Забороняємо видаляти автоматичні записи від накладних
    if entry.finance_type == "invoice" and entry.created_by == "system":
        raise HTTPException(
            status_code=400,
            detail="Автоматичний запис накладної не можна видалити вручну",
        )
    db.delete(entry)
    safe_commit(db)
