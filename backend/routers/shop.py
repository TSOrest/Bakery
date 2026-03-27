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
)
from backend.models.orders import Order
from backend.models.references import Product, Client
from backend.models.finances import Finance, FinanceArticle
from backend.schemas.shop import (
    ShopCountOut, ShopCountUpdate,
    OtherStockInCreate, OtherStockInOut,
    ShopReconciliationOut, ShopReconciliationCreate,
    ShopReconciliationLineOut, ShopReconciliationLineUpdate,
    ShopReconciliationConfirm,
    ShopReceiptCreate, ShopReceiptOut,
    ShopSummary, ShopSummaryProductRow,
)

router = APIRouter(prefix="/shop", tags=["Магазин"])


# ─── Допоміжні функції ────────────────────────────────────────────────────────

def _shop_clients(db: Session) -> List[Client]:
    return db.query(Client).filter(
        Client.client_kind == "shop", Client.is_active == 1
    ).all()


def _received_from_bakery(db: Session, shop_client_id: int, date_from: str, date_to: str) -> dict[int, float]:
    """Надходження з випічки (origin_id=0) для магазину за період, згруповані по product_id."""
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
    """Надходження ззовні (shop_receipts) за період, згруповані по product_id."""
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


def _get_shop_price(db: Session, shop_client_id: int, product_id: int, date: str) -> Optional[float]:
    """Ціна виробу для магазину: client_price_overrides → базова ціна."""
    from backend.models.prices import ClientPriceOverride, Price
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


def _recalc_line(line: ShopReconciliationLine) -> None:
    """Перераховує calculated_sold і expected_cash рядка."""
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


def _opening_balance_for(db: Session, shop_client_id: int, product_id: int, period_from: str) -> float:
    """
    Залишок на початок нової звірки = entered_balance з останньої закритої звірки
    що закінчується до period_from (або initial_stock якщо звірок ще не було).
    """
    last_line = (
        db.query(ShopReconciliationLine)
        .join(ShopReconciliation)
        .filter(
            ShopReconciliation.shop_client_id == shop_client_id,
            ShopReconciliation.period_to < period_from,
            ShopReconciliation.closed == 1,
            ShopReconciliationLine.product_id == product_id,
        )
        .order_by(ShopReconciliation.period_to.desc())
        .first()
    )
    if last_line and last_line.entered_balance is not None:
        return last_line.entered_balance
    product = db.get(Product, product_id)
    return (product.initial_stock or 0) if product else 0.0


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
        all_pids = set(bakery) | set(ext)
        if last_rec:
            all_pids |= {ln.product_id for ln in last_rec.lines}

        rows = []
        for pid in sorted(all_pids):
            product = db.get(Product, pid)
            if not product or not product.is_active:
                continue
            opening = _opening_balance_for(db, shop.id, pid, period_from)
            received = (bakery.get(pid, 0) + ext.get(pid, 0))
            # Продано = з останньої звірки якщо є
            sold = 0.0
            if last_rec:
                ln = next((l for l in last_rec.lines if l.product_id == pid), None)
                if ln and ln.calculated_sold is not None:
                    sold = ln.calculated_sold
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
    db.flush()  # отримуємо rec.id

    bakery = _received_from_bakery(db, data.shop_client_id, data.period_from, data.period_to)
    ext    = _received_from_receipts(db, data.shop_client_id, data.period_from, data.period_to)
    all_pids = set(bakery) | set(ext)

    # Також включити продукти з попередніх закритих звірок (carry-over)
    prev_lines = (
        db.query(ShopReconciliationLine.product_id)
        .join(ShopReconciliation)
        .filter(
            ShopReconciliation.shop_client_id == data.shop_client_id,
            ShopReconciliation.closed == 1,
        )
        .distinct()
        .all()
    )
    for (pid,) in prev_lines:
        all_pids.add(pid)

    for pid in sorted(all_pids):
        product = db.get(Product, pid)
        if not product or not product.is_active:
            continue
        opening  = _opening_balance_for(db, data.shop_client_id, pid, data.period_from)
        received = (bakery.get(pid, 0) + ext.get(pid, 0))
        price    = _get_shop_price(db, data.shop_client_id, pid, data.period_to)
        line = ShopReconciliationLine(
            reconciliation_id=rec.id,
            product_id=pid,
            opening_balance=opening,
            received=received,
            price=price,
        )
        db.add(line)

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
    if body.written_off is not None:
        line.written_off = body.written_off
    if body.price is not None:
        line.price = body.price

    _recalc_line(line)
    _recalc_reconciliation(rec)
    db.commit()
    db.refresh(line)
    return line


@router.post("/reconciliations/{rec_id}/refresh-received", response_model=ShopReconciliationOut)
def refresh_received(rec_id: int, db: Session = Depends(get_db)):
    """Перераховує received для кожного рядка (якщо з'явились нові надходження)."""
    rec = db.get(ShopReconciliation, rec_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Звірку не знайдено")
    if rec.closed:
        raise HTTPException(status_code=400, detail="Звірку вже підтверджено")

    bakery = _received_from_bakery(db, rec.shop_client_id, rec.period_from, rec.period_to)
    ext    = _received_from_receipts(db, rec.shop_client_id, rec.period_from, rec.period_to)

    for line in rec.lines:
        line.received = (bakery.get(line.product_id, 0) + ext.get(line.product_id, 0))
        _recalc_line(line)

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
