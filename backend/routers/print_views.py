"""Ендпоінти для друку: повертають готовий HTML для відкриття у браузері."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from datetime import date as date_type

from backend.database import get_db
from backend.models.invoices import Invoice
from backend.models.baking import BakingTask
from backend.models.references import Product
from backend.models.settings import Setting
from backend.services.orders import aggregate_for_baking

router = APIRouter(prefix="/print", tags=["Друк"])

MONTHS_UK = [
    "", "січня", "лютого", "березня", "квітня", "травня", "червня",
    "липня", "серпня", "вересня", "жовтня", "листопада", "грудня",
]

TYPE_LABELS = {"bread": "Хліб", "bun": "Булки", "other": "Інше"}


def ua_date(iso: str) -> str:
    """'2026-03-16' → '16 березня 2026 р.'"""
    try:
        d = date_type.fromisoformat(iso)
        return f"{d.day} {MONTHS_UK[d.month]} {d.year} р."
    except Exception:
        return iso


def fmt(val: float) -> str:
    """Форматує число з комою: 587.5 → '587,50'"""
    return f"{val:,.2f}".replace(",", " ").replace(".", ",")


def get_settings(db: Session) -> dict[str, str]:
    return {r.key: (r.value or "") for r in db.query(Setting).all()}


PRINT_BTN = """
<div class="no-print" style="position:fixed;top:12px;right:16px;z-index:999;display:flex;gap:8px;">
  <button onclick="window.print()"
    style="padding:6px 18px;background:#1a3a5c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11pt;">
    🖨 Друкувати
  </button>
  <button onclick="window.close()"
    style="padding:6px 12px;background:#eee;border:1px solid #ccc;border-radius:4px;cursor:pointer;font-size:11pt;">
    ✕
  </button>
</div>"""


# ─── Шаблон однієї накладної (повертає HTML-рядок) ───────────────────────────

def render_invoice_block(inv: Invoice, cfg: dict, db: Session, is_copy: bool = False) -> str:
    bakery_name = cfg.get("bakery_name", "Пекарня")
    city        = cfg.get("city", "")
    director    = cfg.get("director", "")
    accountant  = cfg.get("accountant", "")

    client      = inv.client
    client_name = (client.short_name or client.full_name) if client else "—"
    client_addr = (client.address or "") if client else ""
    route_name  = (client.route.name if client and client.route else "") if client else ""

    # Групуємо рядки по типу виробу
    groups: dict[str, list] = {}
    for line in inv.lines:
        product = db.get(Product, line.product_id)
        ptype   = product.type if product else "other"
        groups.setdefault(ptype, []).append((line, product))

    rows_html   = ""
    group_totals = {}
    total_qty   = 0
    total_names = 0

    for ptype in ["bread", "bun", "other"]:
        group = groups.get(ptype, [])
        if not group:
            continue
        g_sum = 0.0
        for line, product in group:
            p_name  = product.name if product else f"#{line.product_id}"
            unit    = product.unit.name if product and product.unit else "шт"
            eff_price = line.price_override if line.price_override else line.price
            exch    = int(line.is_exchange or 0)
            g_sum  += line.sum
            total_qty    += line.qty
            total_names  += 1
            rows_html += f"""
      <tr>
        <td class="n">{p_name}</td>
        <td class="c">{exch or 0}</td>
        <td class="c">{line.qty:g}</td>
        <td class="c">{unit}</td>
        <td class="r">{fmt(eff_price)}</td>
        <td class="r">{fmt(line.sum)}</td>
      </tr>"""
        group_totals[ptype] = g_sum
        label = TYPE_LABELS.get(ptype, ptype)
        rows_html += f"""
      <tr class="subtotal">
        <td colspan="5" class="r">Сума по &nbsp;<b>{label}</b></td>
        <td class="r"><b>{fmt(g_sum)}</b></td>
      </tr>"""

    copy_label = '<div class="copy-label">Копія</div>' if is_copy else ""

    return f"""
<div class="inv-block">
  <div class="inv-top">
    <span class="city"><b>{route_name}</b>{f" · {city}" if city else ""}</span>
    <span class="inv-date">{ua_date(inv.invoice_date)}</span>
  </div>
  {copy_label}
  <div class="inv-title">Накладна №&nbsp;<span class="inv-num">{inv.invoice_number}</span></div>

  <table class="meta-tbl">
    <tr><td class="ml">Від кого:</td><td class="mv"><b>{bakery_name}</b></td></tr>
    <tr><td class="ml">Кому:</td>    <td class="mv"><b>{client_name}</b></td></tr>
    <tr><td class="ml">Через:</td>   <td class="mv">{client_addr}</td></tr>
    <tr><td class="ml">Довіреність №:</td><td class="mv">____________&nbsp; від &nbsp;____________</td></tr>
  </table>

  <table class="lines-tbl">
    <thead>
      <tr>
        <th>Назва</th>
        <th class="c" style="width:32px">Обм.</th>
        <th class="c" style="width:38px">Кільк.</th>
        <th class="c" style="width:32px">Од.</th>
        <th class="r" style="width:54px">Ціна</th>
        <th class="r" style="width:60px">Сума</th>
      </tr>
    </thead>
    <tbody>{rows_html}</tbody>
  </table>

  <div class="total-line">
    Усього&nbsp;<b>{total_names}</b>&nbsp;найменувань,&nbsp;
    <b>{total_qty:g}</b>&nbsp;штук, на суму:
    <span class="total-box">{fmt(inv.total_sum)}</span>
  </div>
  <div class="kopiyky">грн.&nbsp;____&nbsp;коп.</div>

  <div class="sigs">
    <div>Директор:&nbsp;<i>{director or "________________"}</i></div>
    <div>Бухгалтер:&nbsp;<i>{accountant or "________________"}</i></div>
  </div>
  <div class="sigs">
    <div>Прийняв:&nbsp;________________</div>
    <div>Відпускає:&nbsp;<i>Диспетчер</i></div>
  </div>
</div>"""


BASE_CSS = """<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, sans-serif; font-size: 9pt; color: #000; background: #fff; }

/* ── Дві накладні поряд ── */
.page-pair {
  display: flex;
  gap: 6mm;
  padding: 6mm 8mm;
  page-break-after: always;
}
.inv-block {
  flex: 1;
  border: 1px solid #aaa;
  padding: 5mm 4mm;
  min-width: 0;
  position: relative;
}

/* ── Шапка ── */
.inv-top { display: flex; justify-content: space-between; font-size: 8pt; margin-bottom: 1mm; }
.city { font-size: 8.5pt; }
.inv-date { font-size: 8.5pt; font-style: italic; }
.copy-label { font-size: 8pt; color: #555; margin-bottom: 0; }
.inv-title {
  font-size: 13pt; font-weight: bold; text-align: center;
  margin: 2mm 0 3mm;
  border-bottom: 2px solid #000;
  padding-bottom: 2mm;
}
.inv-num { border-bottom: 1px solid #000; min-width: 30mm; display: inline-block; }

/* ── Мета-поля ── */
.meta-tbl { width: 100%; border: none; margin-bottom: 2mm; }
.meta-tbl td { border: none; padding: 0.8mm 0; font-size: 8.5pt; }
.ml { width: 28mm; color: #333; white-space: nowrap; }
.mv { border-bottom: 1px solid #000; }

/* ── Таблиця товарів ── */
.lines-tbl { width: 100%; border-collapse: collapse; margin-bottom: 2mm; font-size: 8.5pt; }
.lines-tbl th {
  background: #d8d8d8; border: 1px solid #777;
  padding: 1.5mm 1.5mm; font-size: 8pt; font-weight: bold;
}
.lines-tbl td { border: 1px solid #aaa; padding: 1mm 1.5mm; }
.lines-tbl tr.subtotal td { background: #f0f0f0; border-top: 1px solid #888; }
.c { text-align: center; }
.r { text-align: right; }
.n { }

/* ── Підсумок ── */
.total-line {
  font-size: 8.5pt; margin: 2mm 0 0.5mm;
  display: flex; align-items: baseline; flex-wrap: wrap; gap: 1mm;
}
.total-box {
  font-size: 12pt; font-weight: bold;
  border: 2px solid #000; padding: 0.5mm 3mm;
  margin-left: 2mm;
}
.kopiyky { font-size: 8pt; color: #555; margin-bottom: 3mm; }

/* ── Підписи ── */
.sigs {
  display: flex; justify-content: space-between;
  font-size: 8pt; margin-top: 2mm;
  border-top: 1px solid #bbb; padding-top: 1.5mm;
}

/* ── Бейкінг ── */
.baking-wrap { max-width: 760px; margin: 0 auto; padding: 12px; }
.baking-header { display: flex; justify-content: space-between; align-items: flex-end;
  border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 10px; }
.section-title { font-size: 10pt; font-weight: bold;
  margin: 10px 0 4px; border-bottom: 1px solid #ccc; padding-bottom: 2px; }
.baking-tbl { width:100%; border-collapse:collapse; margin-bottom:10px; font-size:9.5pt; }
.baking-tbl th { background:#e8e8e8; border:1px solid #999; padding:4px 8px; font-size:9pt; }
.baking-tbl td { border:1px solid #bbb; padding:3px 8px; }
.baking-tbl tfoot td { font-weight:bold; background:#f0f0f0; }
.hint { font-size: 7.5pt; color: #888; text-align: right; margin-bottom: 6px; }
.sig-row { display:flex; gap:30px; margin-top:20px; }
.sig-item { flex:1; border-top:1px solid #000; padding-top:3px; font-size:8pt; color:#444; }

@media print {
  @page { margin: 5mm; size: A4 landscape; }
  .no-print { display: none !important; }
  .page-pair { page-break-after: always; }

  @page :last { page-break-after: avoid; }
}
@media screen {
  .page-pair { max-width: 280mm; margin: 10px auto; background: #fff;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
}
</style>"""


# ─── Одна накладна ───────────────────────────────────────────────────────────

@router.get("/invoice/{invoice_id}", response_class=HTMLResponse)
def print_invoice(invoice_id: int, db: Session = Depends(get_db)):
    inv = db.get(Invoice, invoice_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Накладну не знайдено")
    cfg = get_settings(db)
    original = render_invoice_block(inv, cfg, db, is_copy=False)
    copy     = render_invoice_block(inv, cfg, db, is_copy=True)

    html = f"""<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="UTF-8">
  <title>Накладна {inv.invoice_number}</title>
  {BASE_CSS}
</head>
<body>
{PRINT_BTN}
<div class="page-pair">
  {original}
  {copy}
</div>
</body>
</html>"""
    return HTMLResponse(content=html)


# ─── Кілька накладних маршруту (або за списком ID) ───────────────────────────

@router.get("/invoices", response_class=HTMLResponse)
def print_invoices(
    invoice_date: str,
    route_id: int | None = None,
    ids: str | None = None,   # список ID через кому: "12,15,17"
    db: Session = Depends(get_db),
):
    if ids:
        id_list = [int(x) for x in ids.split(",") if x.strip().isdigit()]
        invoices = (
            db.query(Invoice)
            .filter(Invoice.id.in_(id_list))
            .order_by(Invoice.invoice_number)
            .all()
        )
    elif route_id is not None:
        invoices = (
            db.query(Invoice)
            .filter(Invoice.invoice_date == invoice_date, Invoice.route_id == route_id)
            .order_by(Invoice.invoice_number)
            .all()
        )
    else:
        raise HTTPException(status_code=400, detail="Потрібен route_id або ids")

    if not invoices:
        raise HTTPException(status_code=404, detail="Накладних не знайдено")
    cfg = get_settings(db)

    pages = ""
    for inv in invoices:
        original = render_invoice_block(inv, cfg, db, is_copy=False)
        copy     = render_invoice_block(inv, cfg, db, is_copy=True)
        pages += f'<div class="page-pair">{original}{copy}</div>\n'

    html = f"""<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="UTF-8">
  <title>Накладні {invoice_date}</title>
  {BASE_CSS}
</head>
<body>
{PRINT_BTN}
{pages}
</body>
</html>"""
    return HTMLResponse(content=html)


# ─── Завдання пекарям ─────────────────────────────────────────────────────────

@router.get("/baking", response_class=HTMLResponse)
def print_baking(task_date: str, product_type: Optional[str] = None, db: Session = Depends(get_db)):
    import math
    tasks = (
        db.query(BakingTask)
        .filter(BakingTask.task_date == task_date)
        .order_by(BakingTask.product_id)
        .all()
    )

    # Якщо завдання ще не сформовані — рахуємо з замовлень на льоту (без збереження)
    if not tasks:
        aggregated = aggregate_for_baking(db, task_date)
        if not aggregated:
            raise HTTPException(status_code=404, detail="Замовлень на цю дату не знайдено")

        def _setting(key: str, default: str) -> float:
            row = db.query(Setting).filter(Setting.key == key).first()
            return float(row.value if row else default)

        bun_reserve   = _setting("bun_reserve_pct",  "5")
        bread_reserve = _setting("bread_reserve_pct", "5")

        tasks = []
        for row in aggregated:
            product = db.get(Product, row["product_id"])
            if not product:
                continue
            reserve_pct = bun_reserve if product.type == "bun" else bread_reserve
            t = BakingTask.__new__(BakingTask)
            t.product_id      = row["product_id"]
            t.ordered_qty     = row["ordered_qty"]
            t.recommended_qty = math.ceil(row["ordered_qty"] * (1 + reserve_pct / 100))
            t.baked_qty       = 0
            tasks.append(t)

    cfg         = get_settings(db)
    bakery_name = cfg.get("bakery_name", "Пекарня")

    groups: dict[str, list[BakingTask]] = {"bread": [], "bun": [], "other": []}
    for task in tasks:
        product = db.get(Product, task.product_id)
        ptype   = product.type if product else "other"
        groups.setdefault(ptype, []).append(task)

    types_to_render = [product_type] if product_type in ("bread", "bun", "other") else ["bread", "bun", "other"]

    # Якщо для вибраного типу нема жодного завдання — повертаємо 404
    if product_type in ("bread", "bun", "other") and not groups.get(product_type):
        label = TYPE_LABELS.get(product_type, product_type)
        raise HTTPException(status_code=404, detail=f"Завдань на випічку ({label}) на {task_date} немає")

    groups_html = ""
    for ptype in types_to_render:
        group = groups.get(ptype, [])
        if not group:
            continue
        rows_html = ""
        total_ord = total_rec = 0.0
        for task in group:
            product = db.get(Product, task.product_id)
            p_name  = product.name if product else f"#{task.product_id}"
            total_ord += task.ordered_qty
            total_rec += task.recommended_qty
            rows_html += f"""
            <tr>
              <td>{p_name}</td>
              <td class="r">{task.ordered_qty:g}</td>
              <td class="r">{task.recommended_qty:g}</td>
              <td></td><td></td>
            </tr>"""
        groups_html += f"""
        <div class="section-title">{TYPE_LABELS.get(ptype, ptype)}</div>
        <table class="baking-tbl">
          <thead>
            <tr>
              <th>Виріб</th>
              <th class="r" style="width:90px">Замовлено</th>
              <th class="r" style="width:100px">Рекомендовано</th>
              <th class="c" style="width:80px">Спечено</th>
              <th class="c" style="width:80px">Здано</th>
            </tr>
          </thead>
          <tbody>{rows_html}</tbody>
          <tfoot>
            <tr>
              <td>Разом</td>
              <td class="r">{total_ord:g}</td>
              <td class="r">{total_rec:g}</td>
              <td></td><td></td>
            </tr>
          </tfoot>
        </table>"""

    html = f"""<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="UTF-8">
  <title>Завдання пекарям {task_date}</title>
  {BASE_CSS}
</head>
<body>
{PRINT_BTN}
<div class="baking-wrap">
  <div class="baking-header">
    <div>
      <div style="font-size:13pt;font-weight:bold;">{bakery_name}</div>
      <div style="font-size:11pt;font-weight:bold;margin-top:4px;">Завдання пекарям</div>
    </div>
    <div style="font-size:12pt;font-weight:bold;">{ua_date(task_date)}</div>
  </div>
  <div class="hint">Колонки "Спечено" та "Здано" заповнює пекар вручну</div>
  {groups_html}
  <div class="sig-row" style="margin-top:30px;">
    <div class="sig-item">Відповідальний: ________________</div>
    <div class="sig-item">Пекар: ________________</div>
    <div class="sig-item">Час початку: _______ Кінець: _______</div>
  </div>
</div>
</body>
</html>"""
    return HTMLResponse(content=html)
