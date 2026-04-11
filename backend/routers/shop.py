"""Ендпоінти магазину: звірки з гнучким періодом, каса, надходження ззовні."""

from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
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
    ShopReconciliationOut, ShopReconciliationCreate,
    ShopReconciliationLineOut, ShopReconciliationLineUpdate,
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
    """Надходження з випічки для summary (total per product_id)."""
    rows = (
        db.query(Order.product_id, func.sum(Order.qty).label("total"))
        .filter(
            Order.client_id == shop_client_id,
            Order.origin_id == 0,
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
            Order.origin_id == 0,
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


def _recalc_line(line: ShopReconciliationLine, from_disposal: bool = False) -> None:
    """Перераховує calculated_sold і expected_cash рядка.
    Якщо from_disposal=True — спочатку оновлює written_off як суму disposal_lines."""
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
    if line.calculated_sold is not None and line.price is not None:
        line.expected_cash = round(line.calculated_sold * line.price, 2)
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
    for shop in shops:
        # Остання звірка для цього магазину
        last_rec: Optional[ShopReconciliation] = (
            db.query(ShopReconciliation)
            .filter(ShopReconciliation.shop_client_id == shop.id)
            .order_by(ShopReconciliation.period_to.desc())
            .first()
        )
        if last_rec:
            period_from = last_rec.period_from
            period_to   = last_rec.period_to if last_rec.closed else date
        else:
            period_from = date
            period_to   = date

        bakery  = _received_from_bakery(db, shop.id, period_from, period_to)
        ext     = _received_from_receipts(db, shop.id, period_from, period_to)
        inv     = _received_from_invoices(db, shop.id, period_from, period_to)
        all_pids = set(bakery) | set(ext) | set(inv)
        if last_rec:
            all_pids |= {ln.product_id for ln in last_rec.lines}

        # Batch-завантаження продуктів — один запит замість len(all_pids) db.get()
        products_map = {
            p.id: p
            for p in db.query(Product).filter(Product.id.in_(all_pids)).all()
        } if all_pids else {}

        rows = []
        for pid in sorted(all_pids):
            product = products_map.get(pid)
            if not product or not product.is_active:
                continue
            # Відкриваючий залишок = сума entered_balance всіх рядків продукту в останній закритій звірці
            opening = 0.0
            if last_rec and last_rec.closed:
                opening = sum(ln.entered_balance or 0 for ln in last_rec.lines if ln.product_id == pid)
            elif not last_rec:
                opening = (product.initial_stock or 0)
            received = (bakery.get(pid, 0) + ext.get(pid, 0) + inv.get(pid, 0))
            # Продано = сума calculated_sold з усіх рядків в останній звірці
            sold = 0.0
            if last_rec:
                sold = sum(
                    (ln.calculated_sold or 0) for ln in last_rec.lines if ln.product_id == pid
                )
            current = max(0.0, opening + received - sold)
            price = _get_shop_price(db, shop.id, pid, date)
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


# ─── Звірки ───────────────────────────────────────────────────────────────────

@router.get("/reconciliations", response_model=List[ShopReconciliationOut])
def list_reconciliations(
    shop_client_id: int,
    db: Session = Depends(get_db),
):
    return (
        db.query(ShopReconciliation)
        .filter(ShopReconciliation.shop_client_id == shop_client_id)
        .order_by(ShopReconciliation.period_to.desc())
        .all()
    )


@router.post("/reconciliations", response_model=ShopReconciliationOut, status_code=201)
def create_reconciliation(data: ShopReconciliationCreate, db: Session = Depends(get_db)):
    """
    Створює нову звірку і автоматично заповнює рядки:
    - відкриваючий залишок з попередньої закритої звірки
    - надходження з випічки (origin_id=0) і ззовні (shop_receipts)
    - ціну з client_price_overrides або базових цін
    """
    shop = db.get(Client, data.shop_client_id)
    if not shop or shop.client_kind != "shop":
        raise HTTPException(status_code=400, detail="Вказаний клієнт не є магазином")

    rec = ShopReconciliation(
        shop_client_id=data.shop_client_id,
        period_from=data.period_from,
        period_to=data.period_to,
        created_at=datetime.now().isoformat(),
    )
    db.add(rec)
    db.flush()

    eff_from   = _effective_date_from(db, data.shop_client_id, data.period_from)
    bakery_b   = _received_from_bakery_batched(db, data.shop_client_id, eff_from, data.period_to)
    ext_b      = _received_from_receipts_batched(db, data.shop_client_id, eff_from, data.period_to)
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

    # Початковий залишок (тільки для першої звірки, якщо ще немає закритих)
    if not carry_overs and not db.query(ShopReconciliation).filter(
        ShopReconciliation.shop_client_id == data.shop_client_id,
        ShopReconciliation.closed == 1,
    ).first():
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


@router.get("/reconciliations/{rec_id}", response_model=ShopReconciliationOut)
def get_reconciliation(rec_id: int, db: Session = Depends(get_db)):
    rec = db.get(ShopReconciliation, rec_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Звірку не знайдено")
    return rec


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

    if body.entered_balance is not None:
        line.entered_balance = body.entered_balance
    if body.price is not None:
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

    if body.disposal_type not in ("writeoff", "ration", "client"):
        raise HTTPException(status_code=422, detail="Невірний тип розподілу")
    if body.disposal_type == "client" and not body.client_id:
        raise HTTPException(status_code=422, detail="Для типу 'клієнт' треба вказати client_id")

    disposal = ShopDisposalLine(
        reconciliation_line_id=line_id,
        disposal_type=body.disposal_type,
        client_id=body.client_id,
        qty=body.qty,
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
    Список товарів для POS-інтерфейсу з поточним балансом і ціною.
    """
    # Поточний стан по товарах — беремо з summary-логіки
    last_rec: Optional[ShopReconciliation] = (
        db.query(ShopReconciliation)
        .filter(ShopReconciliation.shop_client_id == shop_client_id)
        .order_by(ShopReconciliation.period_to.desc())
        .first()
    )
    if last_rec:
        period_from = last_rec.period_from
        period_to   = last_rec.period_to if last_rec.closed else date
    else:
        period_from = date
        period_to   = date

    bakery  = _received_from_bakery(db, shop_client_id, period_from, period_to)
    ext     = _received_from_receipts(db, shop_client_id, period_from, period_to)
    inv     = _received_from_invoices(db, shop_client_id, period_from, period_to)
    all_pids = set(bakery) | set(ext) | set(inv)
    if last_rec:
        all_pids |= {ln.product_id for ln in last_rec.lines}

    # POS-продажі за сьогодні (вже зняті з залишку)
    pos_sold_rows = (
        db.query(ShopSale.product_id, func.sum(ShopSale.qty).label("total"))
        .filter(ShopSale.shop_client_id == shop_client_id, ShopSale.sale_date == date)
        .group_by(ShopSale.product_id)
        .all()
    )
    pos_sold = {r.product_id: float(r.total) for r in pos_sold_rows}

    rows = []
    for pid in sorted(all_pids):
        product = db.get(Product, pid)
        if not product or not product.is_active:
            continue
        opening = 0.0
        if last_rec and last_rec.closed:
            opening = sum(ln.entered_balance or 0 for ln in last_rec.lines if ln.product_id == pid)
        elif not last_rec:
            opening = (product.initial_stock or 0)
        received = bakery.get(pid, 0) + ext.get(pid, 0) + inv.get(pid, 0)
        sold = 0.0
        if last_rec:
            sold = sum((ln.calculated_sold or 0) for ln in last_rec.lines if ln.product_id == pid)
        # Поточний залишок зменшується на POS-продажі сьогоднішнього дня
        current = max(0.0, opening + received - sold - pos_sold.get(pid, 0))
        price = _get_shop_price(db, shop_client_id, pid, date)

        # Категорія
        cat_id = product.category_id
        cat_name = None
        if cat_id:
            cat = db.get(Category, cat_id)
            cat_name = cat.name if cat else None

        rows.append(PosProductRow(
            product_id=pid,
            name=product.name,
            short_name=product.short_name,
            category_id=cat_id,
            category_name=cat_name,
            price=price,
            current_balance=current,
        ))
    return rows


def _build_sale_out(session_id: str, lines: list[ShopSale]) -> ShopSaleOut:
    """Зібрати ShopSaleOut з рядків одного session_id."""
    line_outs = [
        ShopSaleLineOut(id=ln.id, product_id=ln.product_id, qty=ln.qty, price=ln.price, amount=ln.amount)
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
