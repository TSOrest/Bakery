"""Ендпоінти магазину: звірки з гнучким періодом, каса, надходження ззовні."""

from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.shop import (
    ShopCount, OtherStockIn,
    ShopReconciliation, ShopReconciliationLine, ShopReceipt,
    ShopDisposalLine, ShopSale,
)
from backend.models.orders import Order
from backend.models.invoices import Invoice, InvoiceLine
from backend.models.references import Product, Category, Client
from backend.models.finances import Finance, FinanceArticle
from backend.routers.auth import require_user
from backend.schemas.shop import (
    ShopCountOut, ShopCountUpdate,
    OtherStockInCreate, OtherStockInOut,
    ShopReconciliationOut, ShopReconciliationHeaderOut, ShopReconciliationCreate,
    ShopReconciliationOpeningCreate,
    ShopReconciliationLineOut, ShopReconciliationLineUpdate,
    ShopReconciliationOpeningCashUpdate,
    ShopReconciliationConfirm,
    ShopReceiptCreate, ShopReceiptOut,
    ShopSummary, ShopSummaryProductRow,
    ShopDisposalLineCreate, ShopDisposalLineOut,
    ShopSaleCreate, ShopSaleOut, ShopSaleLineOut, PosProductRow,
)

router = APIRouter(prefix="/shop", tags=["Магазин"])


# ─── Допоміжні функції ────────────────────────────────────────────────────────

def _shop_clients(db: Session) -> List[Client]:
    return db.query(Client).filter(
        Client.client_kind == "shop", Client.is_active == 1
    ).all()


def _received_from_bakery(db: Session, shop_client_id: int, date_from: str, date_to: str) -> dict[int, float]:
    """Надходження з випічки для summary (total per product_id).
    Враховує звичайні замовлення (origin_id IS NULL) і надлишки (origin_id=0)."""
    rows = (
        db.query(Order.product_id, func.sum(Order.qty).label("total"))
        .filter(
            Order.client_id == shop_client_id,
            or_(Order.origin_id.is_(None), Order.origin_id == 0),
            Order.order_date >= date_from,
            Order.order_date <= date_to,
        )
        .group_by(Order.product_id)
        .all()
    )
    return {r.product_id: float(r.total) for r in rows}


def _received_from_receipts(db: Session, shop_client_id: int, date_from: str, date_to: str) -> dict[int, float]:
    """Надходження ззовні для summary (total per product_id)."""
    rows = (
        db.query(ShopReceipt.product_id, func.sum(ShopReceipt.qty).label("total"))
        .filter(
            ShopReceipt.shop_client_id == shop_client_id,
            ShopReceipt.receipt_date >= date_from,
            ShopReceipt.receipt_date <= date_to,
        )
        .group_by(ShopReceipt.product_id)
        .all()
    )
    return {r.product_id: float(r.total) for r in rows}


def _received_from_bakery_batched(
    db: Session, shop_client_id: int, date_from: str, date_to: str
) -> dict[tuple[int, str], float]:
    """Надходження з випічки для звірки — розбиті по (product_id, order_date)."""
    rows = (
        db.query(Order.product_id, Order.order_date, func.sum(Order.qty).label("total"))
        .filter(
            Order.client_id == shop_client_id,
            or_(Order.origin_id.is_(None), Order.origin_id == 0),
            Order.order_date >= date_from,
            Order.order_date <= date_to,
        )
        .group_by(Order.product_id, Order.order_date)
        .all()
    )
    return {(r.product_id, r.order_date): float(r.total) for r in rows}


def _received_from_receipts_batched(
    db: Session, shop_client_id: int, date_from: str, date_to: str
) -> dict[tuple[int, str], float]:
    """Надходження ззовні для звірки — розбиті по (product_id, receipt_date)."""
    rows = (
        db.query(ShopReceipt.product_id, ShopReceipt.receipt_date, func.sum(ShopReceipt.qty).label("total"))
        .filter(
            ShopReceipt.shop_client_id == shop_client_id,
            ShopReceipt.receipt_date >= date_from,
            ShopReceipt.receipt_date <= date_to,
        )
        .group_by(ShopReceipt.product_id, ShopReceipt.receipt_date)
        .all()
    )
    return {(r.product_id, r.receipt_date): float(r.total) for r in rows}


def _received_from_invoices(db: Session, shop_client_id: int, date_from: str, date_to: str) -> dict[int, float]:
    """Надходження через прийняті накладні (status=accepted) для магазину."""
    rows = (
        db.query(InvoiceLine.product_id, func.sum(InvoiceLine.qty).label("total"))
        .join(Invoice, Invoice.id == InvoiceLine.invoice_id)
        .filter(
            Invoice.client_id == shop_client_id,
            Invoice.status == "accepted",
            Invoice.invoice_date >= date_from,
            Invoice.invoice_date <= date_to,
            InvoiceLine.is_exchange == 0,
            InvoiceLine.is_stale == 0,
        )
        .group_by(InvoiceLine.product_id)
        .all()
    )
    return {r.product_id: float(r.total) for r in rows}


def _get_shop_price(db: Session, shop_client_id: int, product_id: int, date: str) -> Optional[float]:
    """Ціна виробу для магазину: client_price_overrides → базова ціна."""
    from backend.models.pricing import ClientPriceOverride, Price
    override = (
        db.query(ClientPriceOverride)
        .filter(
            ClientPriceOverride.client_id == shop_client_id,
            ClientPriceOverride.product_id == product_id,
            ClientPriceOverride.valid_from <= date,
        )
        .filter(
            (ClientPriceOverride.valid_to == None) | (ClientPriceOverride.valid_to >= date)  # noqa: E711
        )
        .order_by(ClientPriceOverride.valid_from.desc())
        .first()
    )
    if override:
        return override.price
    base = (
        db.query(Price)
        .filter(
            Price.product_id == product_id,
            Price.valid_from <= date,
            Price.is_active == 1,
        )
        .filter(
            (Price.valid_to == None) | (Price.valid_to >= date)  # noqa: E711
        )
        .order_by(Price.valid_from.desc())
        .first()
    )
    return base.price if base else None


def _get_shop_prices_batch(
    db: Session, shop_client_id: int, product_ids: set[int], date: str
) -> dict[int, float]:
    """Завантажує ціни для кількох продуктів за 2 запити (overrides → базові)."""
    from backend.models.pricing import ClientPriceOverride, Price
    result: dict[int, float] = {}
    if not product_ids:
        return result
    pids = list(product_ids)

    overrides = (
        db.query(ClientPriceOverride)
        .filter(
            ClientPriceOverride.client_id == shop_client_id,
            ClientPriceOverride.product_id.in_(pids),
            ClientPriceOverride.valid_from <= date,
        )
        .filter(
            (ClientPriceOverride.valid_to == None) | (ClientPriceOverride.valid_to >= date)  # noqa: E711
        )
        .order_by(ClientPriceOverride.valid_from.desc())
        .all()
    )
    for o in overrides:
        if o.product_id not in result:
            result[o.product_id] = o.price

    remaining = [pid for pid in pids if pid not in result]
    if remaining:
        base_prices = (
            db.query(Price)
            .filter(
                Price.product_id.in_(remaining),
                Price.valid_from <= date,
                Price.is_active == 1,
            )
            .filter((Price.valid_to == None) | (Price.valid_to >= date))  # noqa: E711
            .order_by(Price.valid_from.desc())
            .all()
        )
        for p in base_prices:
            if p.product_id not in result:
                result[p.product_id] = p.price

    return result


def _recalc_line(line: ShopReconciliationLine, from_disposal: bool = False) -> None:
    """Перераховує calculated_sold і expected_cash рядка.
    Якщо from_disposal=True — спочатку оновлює written_off як суму disposal_lines.
    Disposal типу 'sale' (продаж поза POS) входять у written_off, але їх виручка
    (qty × disposal.price) додається до expected_cash окремо."""
    if from_disposal:
        line.written_off = sum(d.qty for d in line.disposal_lines)
    if line.entered_balance is not None:
        line.calculated_sold = max(
            0.0,
            (line.opening_balance or 0) + (line.received or 0)
            - line.entered_balance - (line.written_off or 0),
        )
    else:
        line.calculated_sold = None
    # Виручка від продажу поза POS (disposal_type='sale')
    sale_disposal_cash = round(
        sum(d.qty * (d.price or 0) for d in line.disposal_lines if d.disposal_type == 'sale'), 2
    )
    if line.calculated_sold is not None and line.price is not None:
        line.expected_cash = round(line.calculated_sold * line.price, 2) + sale_disposal_cash
    elif sale_disposal_cash:
        line.expected_cash = sale_disposal_cash
    else:
        line.expected_cash = None


def _recalc_reconciliation(rec: ShopReconciliation) -> None:
    """Перераховує cash_expected по всіх рядках."""
    rec.cash_expected = round(
        sum(ln.expected_cash or 0 for ln in rec.lines), 2
    )
    if rec.cash_actual is not None:
        rec.cash_diff = round(rec.cash_actual - rec.cash_expected, 2)


def _effective_date_from(db: Session, shop_client_id: int, period_from: str) -> str:
    """
    Ефективна дата початку вибірки надходжень для звірки.
    Розширює діапазон на «проміжок» між останньою закритою звіркою та period_from,
    щоб надходження, додані заднім числом, не губились між звірками.
    """
    from datetime import date as _date, timedelta
    last_to = (
        db.query(ShopReconciliation.period_to)
        .filter(
            ShopReconciliation.shop_client_id == shop_client_id,
            ShopReconciliation.closed == 1,
        )
        .order_by(ShopReconciliation.period_to.desc())
        .limit(1)
        .scalar()
    )
    if last_to and last_to < period_from:
        return (_date.fromisoformat(last_to) + timedelta(days=1)).isoformat()
    return period_from


def _carry_over_lines(db: Session, shop_client_id: int, period_from: str) -> list[dict]:
    """
    Рядки перенесення залишків з останньої закритої звірки.
    Зберігає оригінальний batch_date кожного рядка, щоб оператор бачив
    вік кожної партії окремо у новій звірці.
    """
    last_rec = (
        db.query(ShopReconciliation)
        .filter(
            ShopReconciliation.shop_client_id == shop_client_id,
            ShopReconciliation.period_to < period_from,
            ShopReconciliation.closed == 1,
        )
        .order_by(ShopReconciliation.period_to.desc())
        .first()
    )
    if not last_rec:
        return []
    result = []
    for ln in last_rec.lines:
        if ln.entered_balance is not None and ln.entered_balance > 0:
            result.append({
                'product_id': ln.product_id,
                'batch_date': ln.batch_date,   # зберігаємо оригінальну дату партії
                'opening_balance': float(ln.entered_balance),
            })
    return result


# ─── Зведений стан магазину ───────────────────────────────────────────────────

@router.get("/shops")
def list_shops(db: Session = Depends(get_db)):
    """Список клієнтів-магазинів."""
    shops = _shop_clients(db)
    return [{"id": s.id, "name": s.full_name, "short_name": s.short_name} for s in shops]


@router.get("/summary", response_model=List[ShopSummary])
def get_summary(date: str, db: Session = Depends(get_db)):
    """
    Зведений стан по кожному магазину на задану дату.
    Показує поточний (незакритий) баланс або баланс останньої звірки.
    """
    shops = _shop_clients(db)
    result = []
    from datetime import date as _date, timedelta as _td
    for shop in shops:
        # Остання звірка (для відображення дати в summary)
        last_rec: Optional[ShopReconciliation] = (
            db.query(ShopReconciliation)
            .filter(ShopReconciliation.shop_client_id == shop.id)
            .order_by(ShopReconciliation.period_to.desc())
            .first()
        )
        # Остання ЗАКРИТА звірка — база для розрахунку opening і received
        # Якщо last_rec вже закрита — використовуємо її; якщо відкрита — шукаємо попередню
        if last_rec and last_rec.closed:
            last_closed_rec = last_rec
        elif last_rec:
            last_closed_rec = (
                db.query(ShopReconciliation)
                .filter(
                    ShopReconciliation.shop_client_id == shop.id,
                    ShopReconciliation.closed == 1,
                )
                .order_by(ShopReconciliation.period_to.desc())
                .first()
            )
        else:
            last_closed_rec = None

        # Received = все що надійшло ПІСЛЯ останньої закритої звірки
        if last_closed_rec:
            after_to    = (_date.fromisoformat(last_closed_rec.period_to) + _td(days=1)).isoformat()
            period_from = after_to
            period_to   = date
        else:
            period_from = date
            period_to   = date

        bakery  = _received_from_bakery(db, shop.id, period_from, period_to)
        ext     = _received_from_receipts(db, shop.id, period_from, period_to)
        inv     = _received_from_invoices(db, shop.id, period_from, period_to)
        all_pids = set(bakery) | set(ext) | set(inv)
        if last_closed_rec:
            all_pids |= {ln.product_id for ln in last_closed_rec.lines}

        # Batch-завантаження продуктів — один запит замість len(all_pids) db.get()
        products_map = {
            p.id: p
            for p in db.query(Product).filter(Product.id.in_(all_pids)).all()
        } if all_pids else {}

        # Батч-завантаження цін — 2 запити на магазин замість 2*N
        prices_map = _get_shop_prices_batch(db, shop.id, all_pids, date)

        rows = []
        for pid in sorted(all_pids):
            product = products_map.get(pid)
            if not product or not product.is_active:
                continue
            # Opening: entered_balance з ОСТАННЬОЇ ЗАКРИТОЇ звірки
            opening = 0.0
            if last_closed_rec and last_closed_rec.lines:
                opening = sum(ln.entered_balance or 0 for ln in last_closed_rec.lines if ln.product_id == pid)
            elif not last_closed_rec:
                opening = (product.initial_stock or 0)
            received = (bakery.get(pid, 0) + ext.get(pid, 0) + inv.get(pid, 0))
            # sold завжди 0 в summary: current = opening (з закритої звірки) + нові надходження
            sold = 0.0
            current = max(0.0, opening + received - sold)
            price = prices_map.get(pid)
            rows.append(ShopSummaryProductRow(
                product_id=pid,
                product_name=product.name,
                opening_balance=opening,
                received=received,
                sold=sold,
                current_balance=current,
                price=price,
            ))

        result.append(ShopSummary(
            shop_client_id=shop.id,
            shop_name=shop.full_name,
            last_reconciliation_id=last_rec.id if last_rec else None,
            last_reconciliation_from=last_rec.period_from if last_rec else None,
            last_reconciliation_to=last_rec.period_to if last_rec else None,
            last_closed=last_rec.closed if last_rec else 0,
            products=rows,
        ))
    return result


# ─── Сповіщення про зміну ціни ────────────────────────────────────────────────

@router.get("/price-change-alert")
def price_change_alert(db: Session = Depends(get_db)):
    """Перевіряє чи є зміни цін для товарів наявних у відкритій звірці магазину.
    Якщо так — рекомендується закрити звірку щоб переоцінка потрапила в окрему звірку."""
    from datetime import date as _dt
    from backend.models.pricing import Price, ClientPriceOverride

    shop_client = (
        db.query(Client).filter(Client.is_own_shop == 1).first()
        or db.query(Client).filter(Client.client_kind == "shop").first()
    )
    if not shop_client:
        return {"has_alert": False, "products": []}

    open_rec = (
        db.query(ShopReconciliation)
        .filter(ShopReconciliation.shop_client_id == shop_client.id,
                ShopReconciliation.closed == 0)
        .order_by(ShopReconciliation.period_from)
        .first()
    )
    if not open_rec:
        return {"has_alert": False, "products": []}

    last_closed = (
        db.query(ShopReconciliation)
        .filter(ShopReconciliation.shop_client_id == shop_client.id,
                ShopReconciliation.closed == 1,
                ShopReconciliation.rec_type != "opening")
        .order_by(ShopReconciliation.period_to.desc())
        .first()
    )
    price_change_from = last_closed.period_to if last_closed else open_rec.period_from
    today = _dt.today().isoformat()

    # Товари з ненульовим залишком у відкритій звірці
    stock_pids: set[int] = set()
    for ln in open_rec.lines:
        if (ln.opening_balance or 0) > 0 or (ln.entered_balance or 0) > 0:
            stock_pids.add(ln.product_id)
    if last_closed:
        for ln in last_closed.lines:
            if (ln.entered_balance or 0) > 0:
                stock_pids.add(ln.product_id)
    if not stock_pids:
        return {"has_alert": False, "products": []}

    pids_list = list(stock_pids)
    changed: set[int] = set()

    for r in (db.query(Price.product_id)
              .filter(Price.product_id.in_(pids_list),
                      Price.valid_from > price_change_from,
                      Price.valid_from <= today,
                      Price.is_active == 1)
              .distinct().all()):
        changed.add(r[0])

    for r in (db.query(ClientPriceOverride.product_id)
              .filter(ClientPriceOverride.client_id == shop_client.id,
                      ClientPriceOverride.product_id.in_(pids_list),
                      ClientPriceOverride.valid_from > price_change_from,
                      ClientPriceOverride.valid_from <= today)
              .distinct().all()):
        changed.add(r[0])

    if not changed:
        return {"has_alert": False, "products": []}

    from backend.models.references import Product as ProductModel
    products = db.query(ProductModel).filter(ProductModel.id.in_(list(changed))).all()
    return {
        "has_alert": True,
        "products": [{"id": p.id, "name": p.name} for p in products],
    }


# ─── Звірки ───────────────────────────────────────────────────────────────────

@router.get("/reconciliations", response_model=List[ShopReconciliationOut])
def list_reconciliations(
    shop_client_id: int,
    include_lines: bool = Query(True),
    db: Session = Depends(get_db),
):
    recs = (
        db.query(ShopReconciliation)
        .filter(ShopReconciliation.shop_client_id == shop_client_id)
        .order_by(ShopReconciliation.period_to.desc())
        .all()
    )
    if not include_lines:
        # JSONResponse обходить response_model — Pydantic не лізе в r.lines
        return JSONResponse([
            ShopReconciliationHeaderOut.model_validate(r).model_dump()
            for r in recs
        ])
    return recs


@router.post("/reconciliations", response_model=ShopReconciliationOut, status_code=201)
def create_reconciliation(data: ShopReconciliationCreate, db: Session = Depends(get_db)):
    """
    Ідемпотентний: якщо є відкрита звірка для цього магазину — повертає її.
    Інакше створює нову і автоматично заповнює рядки:
    - відкриваючий залишок з попередньої закритої звірки
    - надходження з випічки (origin_id=0) і ззовні (shop_receipts)
    - ціну з client_price_overrides або базових цін
    """
    shop = db.get(Client, data.shop_client_id)
    if not shop or shop.client_kind != "shop":
        raise HTTPException(status_code=400, detail="Вказаний клієнт не є магазином")

    # Якщо вже є відкрита — повернути без дублювання
    existing = (
        db.query(ShopReconciliation)
        .filter(
            ShopReconciliation.shop_client_id == data.shop_client_id,
            ShopReconciliation.closed == 0,
        )
        .first()
    )
    if existing:
        _enrich_rec_in_memory(db, existing)
        return existing

    rec = ShopReconciliation(
        shop_client_id=data.shop_client_id,
        period_from=data.period_from,
        period_to=data.period_to,
        created_at=datetime.now().isoformat(),
    )
    db.add(rec)
    db.flush()

    eff_from = _effective_date_from(db, data.shop_client_id, data.period_from)

    # Остання закрита звірка (потрібна для двох перевірок нижче)
    last_closed = (
        db.query(ShopReconciliation)
        .filter(
            ShopReconciliation.shop_client_id == data.shop_client_id,
            ShopReconciliation.closed == 1,
        )
        .order_by(ShopReconciliation.period_to.desc())
        .first()
    )

    # Якщо остання закрита звірка порожня (placeholder від імпорту без рядків) —
    # захопити всі надходження з самого початку, щоб оператор бачив незвірений товар
    if last_closed and not last_closed.lines:
        eff_from = '2000-01-01'

    bakery_b    = _received_from_bakery_batched(db, data.shop_client_id, eff_from, data.period_to)
    ext_b       = _received_from_receipts_batched(db, data.shop_client_id, eff_from, data.period_to)
    carry_overs = _carry_over_lines(db, data.shop_client_id, data.period_from)

    # Збираємо всі (product_id, batch_date) → {opening, received}
    batch_data: dict[tuple[int, str | None], dict] = {}

    def _ensure(pid: int, bd: str | None) -> dict:
        k = (pid, bd)
        if k not in batch_data:
            batch_data[k] = {'opening': 0.0, 'received': 0.0}
        return batch_data[k]

    for co in carry_overs:
        _ensure(co['product_id'], co['batch_date'])['opening'] += co['opening_balance']
    for (pid, d), qty in bakery_b.items():
        _ensure(pid, d)['received'] += qty
    for (pid, d), qty in ext_b.items():
        _ensure(pid, d)['received'] += qty

    # Початковий залишок — якщо немає закритих звірок АБО остання закрита порожня
    if not carry_overs and (not last_closed or not last_closed.lines):
        for product in db.query(Product).filter(Product.is_active == 1).all():
            if (product.id, None) not in batch_data and (product.initial_stock or 0) > 0:
                _ensure(product.id, None)['opening'] += product.initial_stock

    # Створюємо рядки, сортуємо: по product_id, потім NULL перед датами, потім по даті
    for (pid, batch_date), vals in sorted(
        batch_data.items(),
        key=lambda x: (x[0][0], x[0][1] is not None, x[0][1] or ''),
    ):
        if vals['opening'] == 0 and vals['received'] == 0:
            continue
        product = db.get(Product, pid)
        if not product or not product.is_active:
            continue
        price = _get_shop_price(db, data.shop_client_id, pid, data.period_to)
        db.add(ShopReconciliationLine(
            reconciliation_id=rec.id,
            product_id=pid,
            batch_date=batch_date,
            opening_balance=vals['opening'],
            received=vals['received'],
            price=price,
        ))

    db.commit()
    db.refresh(rec)
    _recalc_reconciliation(rec)
    db.commit()
    db.refresh(rec)
    return rec


def _cash_before_date(db: Session, shop_client_id: int, before_date: str) -> float:
    """Накопичений касовий баланс магазину до вказаної дати (для стартової звірки)."""
    result = db.query(
        func.sum(Finance.amount * Finance.sign)
    ).filter(
        Finance.client_id == shop_client_id,
        Finance.finance_date < before_date,
    ).scalar()
    return float(result or 0)


@router.post("/reconciliations/opening", response_model=ShopReconciliationOut, status_code=201)
def create_opening_reconciliation(
    data: ShopReconciliationOpeningCreate,
    db: Session = Depends(get_db),
    _user=Depends(require_user),
):
    """Стартова (початкова) звірка магазину.
    Датується (start_date - 1 день), closed=1, rec_type='opening'.
    Є якорем ланцюжка: перша реальна звірка бере entered_balance звідси як opening_balance.
    """
    from datetime import date as _date, timedelta
    genesis_date = (_date.fromisoformat(data.start_date) - timedelta(days=1)).isoformat()

    existing = db.query(ShopReconciliation).filter(
        ShopReconciliation.shop_client_id == data.shop_client_id,
        ShopReconciliation.rec_type == 'opening',
    ).first()
    if existing:
        raise HTTPException(400, "Стартова звірка вже існує для цього магазину")

    cash_actual = data.cash_actual if data.cash_actual is not None \
        else _cash_before_date(db, data.shop_client_id, data.start_date)

    now_str = datetime.utcnow().isoformat()
    rec = ShopReconciliation(
        shop_client_id=data.shop_client_id,
        period_from=genesis_date,
        period_to=genesis_date,
        cash_expected=cash_actual,
        cash_actual=cash_actual,
        cash_diff=0.0,
        closed=1,
        closed_at=now_str,
        closed_by="opening",
        created_at=now_str,
        rec_type='opening',
    )
    db.add(rec)
    db.flush()

    for item in data.lines:
        qty = float(item.get('qty') or 0)
        if qty <= 0:
            continue
        db.add(ShopReconciliationLine(
            reconciliation_id=rec.id,
            product_id=int(item['product_id']),
            opening_balance=0.0,
            received=0.0,
            entered_balance=qty,
            written_off=0.0,
            calculated_sold=0.0,
            price=None,
            expected_cash=0.0,
        ))
    db.commit()
    db.refresh(rec)
    return rec


@router.patch("/reconciliations/{rec_id}/opening-cash", response_model=ShopReconciliationOut)
def update_opening_cash(
    rec_id: int,
    body: ShopReconciliationOpeningCashUpdate,
    db: Session = Depends(get_db),
    _user=Depends(require_user),
):
    """Оновлює cash_actual стартової звірки (rec_type='opening')."""
    rec = db.get(ShopReconciliation, rec_id)
    if not rec:
        raise HTTPException(status_code=404)
    if rec.rec_type != 'opening':
        raise HTTPException(status_code=400, detail="Тільки для стартових звірок")
    rec.cash_actual   = body.cash_actual
    rec.cash_expected = body.cash_actual
    rec.cash_diff     = 0.0
    db.commit()
    db.refresh(rec)
    return get_reconciliation(rec_id, db)


def _cash_actual_from_finances(db: Session, shop_client_id: int, period_from: str, period_to: str) -> float:
    """Виведення виручки з магазину: операції 'Оплата' від магазину за period,
    виключаючи «списання» — тобто ті, для яких на ту ж дату і на ту ж суму
    існує парна витрата без клієнта (client_id IS NULL, sign=-1).
    Такі пари створювались у старій програмі для проведення списань через магазин.
    Fallback: якщо статтю 'Оплата' не знайдено — беремо всі sign=+1."""
    article = (
        db.query(FinanceArticle)
        .filter(FinanceArticle.name == "Оплата", FinanceArticle.direction == "income")
        .first()
    )

    # Усі «Оплата» від магазину за period
    income_q = db.query(Finance).filter(
        Finance.client_id == shop_client_id,
        Finance.finance_date >= period_from,
        Finance.finance_date <= period_to,
    )
    income_q = income_q.filter(Finance.article_id == article.id) if article else income_q.filter(Finance.sign == 1)
    income_rows = income_q.all()

    if not income_rows:
        return 0.0

    # Парні витрати-списання: тільки art="Списання" (art_id=18), client=NULL, sign=-1.
    # Саме такі пари створювались у старій програмі для списань через магазин.
    # НЕ враховуємо зарплату, оренду тощо — вони можуть випадково збігатись за сумою.
    списання_article = (
        db.query(FinanceArticle)
        .filter(
            FinanceArticle.name.in_(["Списання", "Списання магазину"]),
            FinanceArticle.direction == "expense",
        )
        .first()
    )
    writeoff_keys: set[tuple[str, float]] = set()
    if списання_article:
        writeoff_keys = {
            (r.finance_date, r.amount)
            for r in db.query(Finance.finance_date, Finance.amount).filter(
                Finance.client_id.is_(None),
                Finance.sign == -1,
                Finance.article_id == списання_article.id,
                Finance.finance_date >= period_from,
                Finance.finance_date <= period_to,
            ).all()
        }

    # Сумуємо лише ті «Оплата», що НЕ мають парної витрати-списання
    return sum(
        r.amount for r in income_rows
        if (r.finance_date, r.amount) not in writeoff_keys
    )


def _get_closing_cash(db: Session, shop_client_id: int, up_to_period_to: str) -> float:
    """Кінцевий залишок у касі станом на кінець up_to_period_to.
    Акумулює ланцюжок від opening: opening_cash + Σ(sold_at_opening_price_i − actual_i).
    Використовує ціни на period_from-1 (як фронтенд opPrice) — щоб уникнути розбіжності
    при зміні ціни всередині звірки."""
    from datetime import date as _dt, timedelta as _td
    recs = (
        db.query(ShopReconciliation)
        .filter(
            ShopReconciliation.shop_client_id == shop_client_id,
            ShopReconciliation.period_to <= up_to_period_to,
        )
        .order_by(ShopReconciliation.period_to)
        .all()
    )
    balance = 0.0
    with db.no_autoflush:
        for r in recs:
            if r.rec_type == "opening":
                balance = r.cash_actual or 0.0
            else:
                _enrich_rec_in_memory(db, r)
                if r.cash_actual is None:
                    r.cash_actual = _cash_actual_from_finances(
                        db, shop_client_id, r.period_from, r.period_to
                    )
                # Ціни на початок звірки (день до period_from) — узгоджено з opPrice фронтенду
                opening_date = (_dt.fromisoformat(r.period_from) - _td(days=1)).isoformat()
                all_pids = {ln.product_id for ln in r.lines}
                op_prices = _get_shop_prices_batch(db, shop_client_id, all_pids, opening_date)
                sold_val = sum(
                    (ln.calculated_sold or 0.0) * op_prices.get(ln.product_id, ln.price or 0.0)
                    for ln in r.lines
                )
                balance += sold_val - (r.cash_actual or 0.0)
    return round(balance, 2)


def _terminal_from_finances(db: Session, shop_client_id: int, period_from: str, period_to: str) -> float:
    """Термінальні надходження від магазину: Оплата з нотатками 'терм*' за period."""
    article = (
        db.query(FinanceArticle)
        .filter(FinanceArticle.name == "Оплата", FinanceArticle.direction == "income")
        .first()
    )
    q = db.query(Finance).filter(
        Finance.client_id == shop_client_id,
        Finance.finance_date >= period_from,
        Finance.finance_date <= period_to,
        Finance.notes.ilike("%терм%"),
    )
    q = q.filter(Finance.article_id == article.id) if article else q.filter(Finance.sign == 1)
    return round(sum(r.amount for r in q.all()), 2)


def _enrich_rec_in_memory(db: Session, rec: ShopReconciliation) -> None:
    """Заповнює поля ціни, received, calculated_sold і cash_expected в пам'яті (без commit).
    Викликати всередині `with db.no_autoflush:`."""

    # 1. Ціни: підтягуємо для рядків де price = None
    lines_no_price = [ln for ln in rec.lines if ln.price is None]
    if lines_no_price:
        pids = {ln.product_id for ln in lines_no_price}
        prices_map = _get_shop_prices_batch(db, rec.shop_client_id, pids, rec.period_to)
        for ln in lines_no_price:
            ln.price = prices_map.get(ln.product_id)

    # 2. Received: якщо всі рядки мають received=0 — дані з імпорту, перераховуємо з замовлень.
    # Opening/genesis-рек пропускаємо — вони є знімком початкового стану, не реальною звіркою.
    if rec.rec_type != 'opening' and rec.lines and all(ln.received == 0 for ln in rec.lines):
        recv_map = _received_from_bakery(db, rec.shop_client_id, rec.period_from, rec.period_to)
        for ln in rec.lines:
            recv = recv_map.get(ln.product_id, 0.0)
            ln.received = recv
            # Перераховуємо calculated_sold: opening + received - entered - written_off
            ln.calculated_sold = max(
                0.0,
                ln.opening_balance + recv - (ln.entered_balance or 0.0) - (ln.written_off or 0.0),
            )

    # 3. cash_expected: якщо 0 — рахуємо з рядків (Σ sold × price)
    if rec.cash_expected == 0:
        rec.cash_expected = sum(
            (ln.calculated_sold or 0.0) * (ln.price or 0.0) for ln in rec.lines
        )


@router.get("/reconciliations/{rec_id}", response_model=ShopReconciliationOut)
def get_reconciliation(rec_id: int, db: Session = Depends(get_db)):
    rec = db.get(ShopReconciliation, rec_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Звірку не знайдено")

    with db.no_autoflush:
        _enrich_rec_in_memory(db, rec)

        # 4. cash_actual: якщо None — беремо з фінансів (всі надходження від магазину)
        if rec.cash_actual is None:
            rec.cash_actual = _cash_actual_from_finances(
                db, rec.shop_client_id, rec.period_from, rec.period_to
            )
            rec.cash_diff = rec.cash_expected - rec.cash_actual

        # 5. Залишок у касі ПІСЛЯ попередньої звірки
        prev_rec = (
            db.query(ShopReconciliation)
            .filter(
                ShopReconciliation.shop_client_id == rec.shop_client_id,
                ShopReconciliation.period_to < rec.period_from,
            )
            .order_by(ShopReconciliation.period_to.desc())
            .first()
        )
        prev_cash_balance = 0.0
        prev_stock_value = 0.0
        if prev_rec:
            prev_cash_balance = _get_closing_cash(
                db, rec.shop_client_id, prev_rec.period_to
            )
            # "Товар поч." = вартість залишку на кінець попередньої звірки
            # (entered_balance × ціна попереднього дня, а не сьогоднішня)
            with db.no_autoflush:
                _enrich_rec_in_memory(db, prev_rec)
            prev_stock_value = round(
                sum((ln.entered_balance or 0.0) * (ln.price or 0.0) for ln in prev_rec.lines), 2
            )

    terminal_cash = _terminal_from_finances(
        db, rec.shop_client_id, rec.period_from, rec.period_to
    )

    # 6. Ціни на початок звірки (день до period_from) — для переоцінки залишку
    from datetime import date as _dt, timedelta as _td
    opening_date = (_dt.fromisoformat(rec.period_from) - _td(days=1)).isoformat()
    all_pids = {ln.product_id for ln in rec.lines}
    opening_prices: dict[int, float] = {}
    if all_pids:
        opening_prices = _get_shop_prices_batch(db, rec.shop_client_id, all_pids, opening_date)

    revaluation_sum = round(sum(
        (ln.entered_balance or 0.0)
        * ((ln.price or 0.0) - opening_prices.get(ln.product_id, ln.price or 0.0))
        for ln in rec.lines
    ), 2)

    out = ShopReconciliationOut.model_validate(rec)
    data = out.model_dump()
    data["prev_cash_balance"] = prev_cash_balance
    data["prev_stock_value"] = prev_stock_value
    data["terminal_cash"] = terminal_cash
    data["opening_prices"] = {str(pid): p for pid, p in opening_prices.items()}
    data["revaluation_sum"] = revaluation_sum if revaluation_sum != 0.0 else None
    return JSONResponse(data)


@router.put(
    "/reconciliations/{rec_id}/lines/{line_id}",
    response_model=ShopReconciliationLineOut,
)
def update_reconciliation_line(
    rec_id: int,
    line_id: int,
    body: ShopReconciliationLineUpdate,
    db: Session = Depends(get_db),
):
    rec = db.get(ShopReconciliation, rec_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Звірку не знайдено")
    if rec.closed:
        raise HTTPException(status_code=400, detail="Звірку підтверджено, редагування заблоковано")

    line = db.get(ShopReconciliationLine, line_id)
    if not line or line.reconciliation_id != rec_id:
        raise HTTPException(status_code=404, detail="Рядок не знайдено")

    # Використовуємо model_fields_set щоб відрізнити "не передано" від явного null
    if 'entered_balance' in body.model_fields_set:
        line.entered_balance = body.entered_balance
    if 'price' in body.model_fields_set:
        line.price = body.price

    _recalc_line(line, from_disposal=bool(line.disposal_lines))
    _recalc_reconciliation(rec)
    db.commit()
    db.refresh(line)
    return line


@router.post("/reconciliations/{rec_id}/refresh-received", response_model=ShopReconciliationOut)
def refresh_received(rec_id: int, db: Session = Depends(get_db)):
    """
    Оновлює received для кожного рядка і додає нові рядки для продуктів,
    що з'явились у надходженнях після створення звірки.
    """
    rec = db.get(ShopReconciliation, rec_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Звірку не знайдено")
    if rec.closed:
        raise HTTPException(status_code=400, detail="Звірку вже підтверджено")

    eff_from = _effective_date_from(db, rec.shop_client_id, rec.period_from)
    bakery_b = _received_from_bakery_batched(db, rec.shop_client_id, eff_from, rec.period_to)
    ext_b    = _received_from_receipts_batched(db, rec.shop_client_id, eff_from, rec.period_to)

    # ── Крок 1: нормалізація NULL-рядків старого формату ──────────────────────
    # Старий формат зберігав received у NULL-рядку — скидаємо до 0.
    for line in rec.lines:
        if line.batch_date is None and line.received != 0:
            line.received = 0

    # Видаляємо порожні NULL-рядки (opening=0, без даних оператора, без disposal)
    to_delete = [
        ln for ln in rec.lines
        if ln.batch_date is None
        and (ln.opening_balance or 0) == 0
        and ln.entered_balance is None
        and not ln.disposal_lines
    ]
    for ln in to_delete:
        db.delete(ln)
    db.flush()
    db.refresh(rec)

    # ── Крок 2: індекс існуючих рядків ────────────────────────────────────────
    existing: dict[tuple[int, str | None], ShopReconciliationLine] = {
        (ln.product_id, ln.batch_date): ln for ln in rec.lines
    }
    existing_pids: set[int] = {pid for (pid, _) in existing}

    # ── Крок 3: оновлюємо received для всіх існуючих рядків ───────────────────
    for (pid, batch_date), line in existing.items():
        line.received = bakery_b.get((pid, batch_date), 0) + ext_b.get((pid, batch_date), 0)
        if batch_date is None:
            line.received = 0  # NULL-рядки завжди received=0
        _recalc_line(line, from_disposal=bool(line.disposal_lines))

    # ── Крок 4: нові (product_id, batch_date) яких ще нема ────────────────────
    new_batches: set[tuple[int, str]] = {(p, d) for (p, d) in bakery_b} | {(p, d) for (p, d) in ext_b}
    for (pid, batch_date) in sorted(new_batches - set(existing.keys())):
        product = db.get(Product, pid)
        if not product or not product.is_active:
            continue
        received = bakery_b.get((pid, batch_date), 0) + ext_b.get((pid, batch_date), 0)
        if received == 0:
            continue
        price = _get_shop_price(db, rec.shop_client_id, pid, rec.period_to)

        # Зовсім новий продукт — додаємо carry-over рядки з попередньої звірки
        if pid not in existing_pids:
            for co in _carry_over_lines(db, rec.shop_client_id, rec.period_from):
                if co['product_id'] == pid:
                    co_key: tuple[int, str | None] = (pid, co['batch_date'])
                    if co_key not in existing:
                        db.add(ShopReconciliationLine(
                            reconciliation_id=rec.id,
                            product_id=pid,
                            batch_date=co['batch_date'],
                            opening_balance=co['opening_balance'],
                            received=0,
                            price=price,
                        ))
                        existing[co_key] = None  # type: ignore
            existing_pids.add(pid)

        db.add(ShopReconciliationLine(
            reconciliation_id=rec.id,
            product_id=pid,
            batch_date=batch_date,
            opening_balance=0,
            received=received,
            price=price,
        ))

    _recalc_reconciliation(rec)
    db.commit()
    db.refresh(rec)
    return rec


@router.post("/reconciliations/{rec_id}/confirm", response_model=ShopReconciliationOut)
def confirm_reconciliation(
    rec_id: int,
    body: ShopReconciliationConfirm,
    db: Session = Depends(get_db),
):
    """
    Підтверджує звірку:
    - фіналізує calculated_sold і expected_cash
    - зберігає cash_actual і cash_diff
    - автоматично створює запис у фінансах (Виручка магазину)
    """
    rec = db.get(ShopReconciliation, rec_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Звірку не знайдено")
    if rec.closed:
        raise HTTPException(status_code=400, detail="Звірку вже підтверджено")

    # Фіналізуємо рядки
    for line in rec.lines:
        _recalc_line(line)

    _recalc_reconciliation(rec)

    if body.cash_actual is not None:
        rec.cash_actual = body.cash_actual
        rec.cash_diff   = round(body.cash_actual - rec.cash_expected, 2)

    if body.notes:
        rec.notes = body.notes

    rec.closed    = 1
    rec.closed_at = datetime.now().isoformat()

    # Запис у фінансах
    if body.cash_actual is not None and body.cash_actual > 0:
        article = (
            db.query(FinanceArticle)
            .filter(FinanceArticle.name == "Виручка магазину")
            .first()
        )
        if not article:
            article = FinanceArticle(
                name="Виручка магазину", direction="income", is_system=1
            )
            db.add(article)
            db.flush()

        fin = Finance(
            finance_date=rec.period_to,
            client_id=rec.shop_client_id,
            finance_type="shop_revenue",
            article_id=article.id,
            amount=body.cash_actual,
            sign=1,
            notes=f"Виручка магазину за {rec.period_from}–{rec.period_to}",
            created_at=datetime.now().isoformat(),
        )
        db.add(fin)

    db.commit()
    db.refresh(rec)
    return rec


@router.delete("/reconciliations/{rec_id}", status_code=204)
def delete_reconciliation(rec_id: int, db: Session = Depends(get_db)):
    rec = db.get(ShopReconciliation, rec_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Звірку не знайдено")
    if rec.closed:
        raise HTTPException(status_code=400, detail="Закриту звірку не можна видалити")
    db.delete(rec)
    db.commit()


# ─── Розподіл списань рядка звірки ───────────────────────────────────────────

@router.post(
    "/reconciliations/{rec_id}/lines/{line_id}/disposals",
    response_model=ShopReconciliationLineOut,
)
def add_disposal(
    rec_id: int,
    line_id: int,
    body: ShopDisposalLineCreate,
    db: Session = Depends(get_db),
):
    """Додає рядок розподілу (списання / пайок / клієнт) і перераховує written_off."""
    rec = db.get(ShopReconciliation, rec_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Звірку не знайдено")
    if rec.closed:
        raise HTTPException(status_code=400, detail="Звірку закрито, редагування заблоковано")

    line = db.query(ShopReconciliationLine).filter_by(id=line_id, reconciliation_id=rec_id).first()
    if not line:
        raise HTTPException(status_code=404, detail="Рядок не знайдено")

    if body.disposal_type not in ("writeoff", "ration", "client", "sale"):
        raise HTTPException(status_code=422, detail="Невірний тип розподілу")
    if body.disposal_type == "client" and not body.client_id:
        raise HTTPException(status_code=422, detail="Для типу 'клієнт' треба вказати client_id")
    if body.disposal_type == "sale" and not body.price:
        raise HTTPException(status_code=422, detail="Для типу 'продаж' треба вказати ціну")

    disposal = ShopDisposalLine(
        reconciliation_line_id=line_id,
        disposal_type=body.disposal_type,
        client_id=body.client_id,
        qty=body.qty,
        price=body.price,
        notes=body.notes,
        created_at=datetime.now().isoformat(),
    )
    db.add(disposal)
    db.flush()

    _recalc_line(line, from_disposal=True)
    _recalc_reconciliation(rec)
    db.commit()
    db.refresh(line)
    return line


@router.delete(
    "/reconciliations/{rec_id}/lines/{line_id}/disposals/{disposal_id}",
    status_code=204,
)
def delete_disposal(
    rec_id: int,
    line_id: int,
    disposal_id: int,
    db: Session = Depends(get_db),
):
    """Видаляє рядок розподілу і перераховує written_off."""
    rec = db.get(ShopReconciliation, rec_id)
    if not rec or rec.closed:
        raise HTTPException(status_code=400, detail="Звірку закрито або не знайдено")

    disposal = db.query(ShopDisposalLine).filter_by(
        id=disposal_id, reconciliation_line_id=line_id
    ).first()
    if not disposal:
        raise HTTPException(status_code=404, detail="Рядок розподілу не знайдено")

    db.delete(disposal)
    db.flush()

    line = db.get(ShopReconciliationLine, line_id)
    if line:
        _recalc_line(line, from_disposal=True)

    _recalc_reconciliation(rec)
    db.commit()


# ─── Надходження ззовні ───────────────────────────────────────────────────────

@router.get("/receipts", response_model=List[ShopReceiptOut])
def list_receipts(
    shop_client_id: int,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(ShopReceipt).filter(ShopReceipt.shop_client_id == shop_client_id)
    if date_from:
        q = q.filter(ShopReceipt.receipt_date >= date_from)
    if date_to:
        q = q.filter(ShopReceipt.receipt_date <= date_to)
    return q.order_by(ShopReceipt.receipt_date.desc()).all()


@router.post("/receipts", response_model=ShopReceiptOut, status_code=201)
def create_receipt(data: ShopReceiptCreate, db: Session = Depends(get_db)):
    r = ShopReceipt(**data.model_dump(), created_at=datetime.now().isoformat())
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


@router.delete("/receipts/{receipt_id}", status_code=204)
def delete_receipt(receipt_id: int, db: Session = Depends(get_db)):
    r = db.get(ShopReceipt, receipt_id)
    if not r:
        raise HTTPException(status_code=404, detail="Надходження не знайдено")
    # Блокування: не можна видаляти надходження у закритому діапазоні
    last_closed = (
        db.query(ShopReconciliation)
        .filter(
            ShopReconciliation.shop_client_id == r.shop_client_id,
            ShopReconciliation.closed == 1,
        )
        .order_by(ShopReconciliation.period_to.desc())
        .first()
    )
    if last_closed and r.receipt_date <= last_closed.period_to:
        raise HTTPException(status_code=409, detail="Надходження у закритому діапазоні — видалення заборонено")
    db.delete(r)
    db.commit()


# ─── Старі ендпоінти (сумісність) ────────────────────────────────────────────

@router.get("/counts", response_model=List[ShopCountOut])
def list_counts(count_date: str, db: Session = Depends(get_db)):
    return (
        db.query(ShopCount)
        .filter(ShopCount.count_date == count_date)
        .order_by(ShopCount.product_id)
        .all()
    )


@router.put("/counts/{count_id}", response_model=ShopCountOut)
def update_count(count_id: int, body: ShopCountUpdate, db: Session = Depends(get_db)):
    sc = db.get(ShopCount, count_id)
    if not sc:
        raise HTTPException(status_code=404, detail="Рядок звірки не знайдено")
    if sc.saved:
        raise HTTPException(status_code=400, detail="Звірку вже підтверджено")
    if body.entered_balance is not None:
        sc.entered_balance = body.entered_balance
    if body.written_off_entered is not None:
        sc.written_off_entered = body.written_off_entered
    if body.price is not None:
        sc.price = body.price
    if sc.entered_balance is not None:
        sc.calculated_sold = max(
            0.0,
            sc.yesterday_balance + sc.received_today - sc.entered_balance - sc.written_off_entered,
        )
    db.commit()
    db.refresh(sc)
    return sc


@router.get("/other-products")
def list_other_products(db: Session = Depends(get_db)):
    from backend.models.references import OtherProduct
    return db.query(OtherProduct).filter(OtherProduct.is_active == 1).all()


@router.get("/stock-in")
def list_stock_in(stock_date: str, db: Session = Depends(get_db)):
    return db.query(OtherStockIn).filter(OtherStockIn.stock_date == stock_date).all()


@router.post("/stock-in", response_model=OtherStockInOut, status_code=201)
def create_stock_in(stock_date: str, data: OtherStockInCreate, db: Session = Depends(get_db)):
    s = OtherStockIn(**data.model_dump(), stock_date=stock_date, created_at=datetime.now().isoformat())
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


@router.delete("/stock-in/{stock_in_id}", status_code=204)
def delete_stock_in(stock_in_id: int, db: Session = Depends(get_db)):
    s = db.get(OtherStockIn, stock_in_id)
    if not s:
        raise HTTPException(status_code=404, detail="Не знайдено")
    db.delete(s)
    db.commit()


# ─── POS-каса ─────────────────────────────────────────────────────────────────

@router.get("/pos/products", response_model=List[PosProductRow])
def pos_products(shop_client_id: int, date: str, db: Session = Depends(get_db)):
    """
    Список товарів для POS-інтерфейсу по партіях (product_id, batch_date).
    Відкрита звірка або остання закрита визначає залишок кожної партії.
    """
    from datetime import date as _date_type

    # Знайти відкриту звірку (або останню закриту як базу)
    open_rec: Optional[ShopReconciliation] = (
        db.query(ShopReconciliation)
        .filter(
            ShopReconciliation.shop_client_id == shop_client_id,
            ShopReconciliation.closed == 0,
        )
        .first()
    )
    base_rec: Optional[ShopReconciliation] = open_rec or (
        db.query(ShopReconciliation)
        .filter(ShopReconciliation.shop_client_id == shop_client_id)
        .order_by(ShopReconciliation.period_to.desc())
        .first()
    )
    period_from = base_rec.period_from if base_rec else date

    # POS-продажі за поточний сеанс (від period_from до сьогодні) по (product_id, batch_date)
    pos_sold_rows = (
        db.query(ShopSale.product_id, ShopSale.batch_date, func.sum(ShopSale.qty).label("total"))
        .filter(
            ShopSale.shop_client_id == shop_client_id,
            ShopSale.sale_date >= period_from,
            ShopSale.sale_date <= date,
        )
        .group_by(ShopSale.product_id, ShopSale.batch_date)
        .all()
    )
    pos_sold: dict[tuple[int, str | None], float] = {
        (r.product_id, r.batch_date): float(r.total) for r in pos_sold_rows
    }

    today = _date_type.fromisoformat(date)
    rows = []
    if base_rec:
        for ln in base_rec.lines:
            product = db.get(Product, ln.product_id)
            if not product or not product.is_active:
                continue
            # Залишок партії = (entering balance або opening+received) мінус POS-продажі цієї партії
            if base_rec.closed:
                batch_balance = ln.entered_balance or 0
            else:
                batch_balance = (ln.opening_balance or 0) + (ln.received or 0)
            batch_balance = max(0.0, batch_balance - pos_sold.get((ln.product_id, ln.batch_date), 0))
            if batch_balance <= 0:
                continue

            price = _get_shop_price(db, shop_client_id, ln.product_id, date)
            # Для старих партій підказка ціни — остання ціна реалізації
            age_days: Optional[int] = None
            if ln.batch_date:
                age_days = (today - _date_type.fromisoformat(ln.batch_date)).days
                if age_days > 0 and not price:
                    # Шукаємо останній sale-disposal для цього продукту
                    last_sale_d = (
                        db.query(ShopDisposalLine)
                        .join(ShopReconciliationLine)
                        .filter(
                            ShopReconciliationLine.product_id == ln.product_id,
                            ShopDisposalLine.disposal_type == 'sale',
                            ShopDisposalLine.price.isnot(None),
                        )
                        .order_by(ShopDisposalLine.id.desc())
                        .first()
                    )
                    if last_sale_d:
                        price = last_sale_d.price

            cat_id = product.category_id
            cat_name = None
            if cat_id:
                cat = db.get(Category, cat_id)
                cat_name = cat.name if cat else None

            rows.append(PosProductRow(
                product_id=ln.product_id,
                name=product.name,
                short_name=product.short_name,
                category_id=cat_id,
                category_name=cat_name,
                price=price,
                current_balance=batch_balance,
                batch_date=ln.batch_date,
                age_days=age_days,
            ))
    # Сортуємо: по product_id, потім NULL-партії після нових (старіші — нижче)
    rows.sort(key=lambda r: (r.product_id, r.batch_date is None, r.batch_date or ''))
    return rows


def _build_sale_out(session_id: str, lines: list[ShopSale]) -> ShopSaleOut:
    """Зібрати ShopSaleOut з рядків одного session_id."""
    line_outs = [
        ShopSaleLineOut(id=ln.id, product_id=ln.product_id, qty=ln.qty, price=ln.price, amount=ln.amount, batch_date=ln.batch_date)
        for ln in lines
    ]
    first = lines[0]
    return ShopSaleOut(
        session_id=session_id,
        shop_client_id=first.shop_client_id,
        sale_date=first.sale_date,
        lines=line_outs,
        total=sum(ln.amount for ln in lines),
        created_at=first.created_at,
        created_by=first.created_by,
    )


@router.post("/sales", response_model=ShopSaleOut, status_code=201)
def create_sale(
    data: ShopSaleCreate,
    current_user=Depends(require_user),
    db: Session = Depends(get_db),
):
    """Зареєструвати продаж (один чек = масив позицій)."""
    import uuid
    session_id = data.session_id or str(uuid.uuid4())
    now = datetime.now().isoformat()
    created_lines = []
    for ln in data.lines:
        sale = ShopSale(
            shop_client_id=data.shop_client_id,
            sale_date=data.sale_date,
            product_id=ln.product_id,
            qty=ln.qty,
            price=ln.price,
            amount=round(ln.qty * ln.price, 4),
            session_id=session_id,
            batch_date=ln.batch_date,
            notes=data.notes,
            created_at=now,
            created_by=current_user.username,
        )
        db.add(sale)
        created_lines.append(sale)
    db.commit()
    for s in created_lines:
        db.refresh(s)
    return _build_sale_out(session_id, created_lines)


@router.get("/sales", response_model=List[ShopSaleOut])
def list_sales(
    shop_client_id: int,
    date: str,
    db: Session = Depends(get_db),
):
    """Список чеків магазину за день, згруповані по session_id."""
    rows = (
        db.query(ShopSale)
        .filter(ShopSale.shop_client_id == shop_client_id, ShopSale.sale_date == date)
        .order_by(ShopSale.created_at)
        .all()
    )
    # Групуємо по session_id
    from collections import defaultdict
    groups: dict[str, list[ShopSale]] = defaultdict(list)
    for row in rows:
        groups[row.session_id or str(row.id)].append(row)
    return [_build_sale_out(sid, lines) for sid, lines in groups.items()]


@router.delete("/sales/{session_id}", status_code=204)
def delete_sale(
    session_id: str,
    current_user=Depends(require_user),
    db: Session = Depends(get_db),
):
    """Скасувати чек (видалити всі рядки з цим session_id)."""
    rows = db.query(ShopSale).filter(ShopSale.session_id == session_id).all()
    if not rows:
        raise HTTPException(status_code=404, detail="Чек не знайдено")
    for row in rows:
        db.delete(row)
    db.commit()
