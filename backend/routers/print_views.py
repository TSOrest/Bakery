"""Ендпоінти для друку: повертають готовий HTML для відкриття у браузері."""

from typing import Optional
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from datetime import date as date_type

from sqlalchemy import func

from backend.database import get_db
from backend.models.invoices import Invoice, InvoiceLine
from backend.models.baking import BakingTask
from backend.models.references import Product, Category, Client, Route
from backend.models.finances import Finance, FinanceArticle
from backend.models.orders import Order
from backend.models.settings import Setting
from backend.services.orders import aggregate_for_baking

router = APIRouter(prefix="/print", tags=["Друк"])

MONTHS_UK = [
    "", "січня", "лютого", "березня", "квітня", "травня", "червня",
    "липня", "серпня", "вересня", "жовтня", "листопада", "грудня",
]



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

    # Завантажуємо категорії для відображення назв і сортування
    all_cats: dict[int, Category] = {c.id: c for c in db.query(Category).all()}

    # Розділяємо рядки: основні і обмін
    main_lines = [line for line in inv.lines if not line.is_exchange]
    exch_lines = [line for line in inv.lines if line.is_exchange]

    # Групуємо основні рядки по категорії виробу (відділу)
    # cat_id → [(line, product)]
    groups: dict[int | None, list] = {}
    cat_order: list[int | None] = []
    for line in main_lines:
        product = db.get(Product, line.product_id)
        cid = product.category_id if product else None
        if cid not in groups:
            groups[cid] = []
            cat_order.append(cid)
        groups[cid].append((line, product))

    # Сортуємо групи за sort_order категорії
    cat_order.sort(key=lambda cid: all_cats[cid].sort_order if cid and cid in all_cats else 999)

    rows_html   = ""
    group_totals: dict[int | None, float] = {}
    total_qty   = 0
    total_names = 0

    for cid in cat_order:
        group = groups[cid]
        cat_label = all_cats[cid].name if cid and cid in all_cats else "Інше"
        g_sum = 0.0
        for line, product in group:
            p_name    = product.name if product else f"#{line.product_id}"
            unit      = product.unit.name if product and product.unit else "шт"
            eff_price = line.price_override if line.price_override else line.price
            g_sum    += line.sum
            total_qty    += line.qty
            total_names  += 1
            rows_html += f"""
      <tr>
        <td class="n">{p_name}</td>
        <td class="c">{line.qty:g}</td>
        <td class="c">{unit}</td>
        <td class="r">{fmt(eff_price)}</td>
        <td class="r">{fmt(line.sum)}</td>
      </tr>"""
        group_totals[cid] = g_sum
        rows_html += f"""
      <tr class="subtotal">
        <td colspan="4" class="r">Сума по &nbsp;<b>{cat_label}</b></td>
        <td class="r"><b>{fmt(g_sum)}</b></td>
      </tr>"""

    # Секція обміну (опціонально)
    exch_html = ""
    if exch_lines:
        exch_rows = ""
        exch_total = 0.0
        for line in exch_lines:
            product   = db.get(Product, line.product_id)
            p_name    = product.name if product else f"#{line.product_id}"
            unit      = product.unit.name if product and product.unit else "шт"
            eff_price = line.price_override if line.price_override else line.price
            exch_total += line.sum
            exch_rows += f"""
      <tr>
        <td class="n">{p_name}</td>
        <td class="c">{line.qty:g}</td>
        <td class="c">{unit}</td>
        <td class="r">{fmt(eff_price)}</td>
        <td class="r">{fmt(line.sum)}</td>
      </tr>"""
        exch_html = f"""
  <div class="exch-section">
    <div class="exch-title">Обмін</div>
    <table class="lines-tbl">
      <thead>
        <tr>
          <th>Назва</th>
          <th class="c" style="width:38px">Кільк.</th>
          <th class="c" style="width:32px">Од.</th>
          <th class="r" style="width:54px">Ціна</th>
          <th class="r" style="width:60px">Сума</th>
        </tr>
      </thead>
      <tbody>{exch_rows}</tbody>
      <tfoot>
        <tr class="subtotal">
          <td colspan="4" class="r">Сума обміну</td>
          <td class="r"><b>{fmt(exch_total)}</b></td>
        </tr>
      </tfoot>
    </table>
  </div>"""

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
        <th class="c" style="width:38px">Кільк.</th>
        <th class="c" style="width:32px">Од.</th>
        <th class="r" style="width:54px">Ціна</th>
        <th class="r" style="width:60px">Сума</th>
      </tr>
    </thead>
    <tbody>{rows_html}</tbody>
  </table>
  {exch_html}

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
body { font-family: Arial, sans-serif; font-size: 10pt; color: #000; background: #fff; }

/* ── Дві накладні поряд ── */
.page-pair {
  display: flex;
  gap: 5mm;
  padding: 3mm 5mm;
  page-break-after: always;
}
.inv-block {
  flex: 1;
  border: 1px solid #aaa;
  padding: 4mm 3mm;
  min-width: 0;
  position: relative;
}

/* ── Шапка ── */
.inv-top { display: flex; justify-content: space-between; font-size: 9pt; margin-bottom: 1mm; }
.city { font-size: 9.5pt; }
.inv-date { font-size: 9.5pt; font-style: italic; }
.copy-label { font-size: 9pt; color: #555; margin-bottom: 0; }
.inv-title {
  font-size: 14pt; font-weight: bold; text-align: center;
  margin: 1.5mm 0 2mm;
  border-bottom: 2px solid #000;
  padding-bottom: 1.5mm;
}
.inv-num { border-bottom: 1px solid #000; min-width: 30mm; display: inline-block; }

/* ── Мета-поля ── */
.meta-tbl { width: 100%; border: none; margin-bottom: 1.5mm; }
.meta-tbl td { border: none; padding: 0.5mm 0; font-size: 9.5pt; }
.ml { width: 28mm; color: #333; white-space: nowrap; }
.mv { border-bottom: 1px solid #000; }

/* ── Таблиця товарів ── */
.lines-tbl { width: 100%; border-collapse: collapse; margin-bottom: 1.5mm; font-size: 9.5pt; }
.lines-tbl th {
  background: #d8d8d8; border: 1px solid #777;
  padding: 1mm 1mm; font-size: 9pt; font-weight: bold;
}
.lines-tbl td { border: 1px solid #aaa; padding: 0.7mm 1mm; }
.lines-tbl tr.subtotal td { background: #f0f0f0; border-top: 1px solid #888; }
.c { text-align: center; }
.r { text-align: right; }
.n { }

/* ── Секція обміну ── */
.exch-section { margin-top: 1.5mm; }
.exch-title {
  font-size: 9pt; font-weight: bold; text-transform: uppercase; color: #555;
  border-top: 1px dashed #aaa; padding-top: 1mm; margin-bottom: 1mm;
}

/* ── Підсумок ── */
.total-line {
  font-size: 9.5pt; margin: 1.5mm 0 0.5mm;
  display: flex; align-items: baseline; flex-wrap: wrap; gap: 1mm;
}
.total-box {
  font-size: 13pt; font-weight: bold;
  border: 2px solid #000; padding: 0.5mm 3mm;
  margin-left: 2mm;
}
.kopiyky { font-size: 9pt; color: #555; margin-bottom: 2mm; }

/* ── Підписи ── */
.sigs {
  display: flex; justify-content: space-between;
  font-size: 9pt; margin-top: 1.5mm;
  border-top: 1px solid #bbb; padding-top: 1mm;
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


# ─── PDF для Telegram ────────────────────────────────────────────────────────

# CSS без flexbox — сумісний з xhtml2pdf (FONTS_DIR_PLACEHOLDER замінюється динамічно)
_PDF_CSS_TPL = """<style>
@font-face {
    font-family: ArialCYR;
    src: url('FONTS_DIR_PLACEHOLDER/arial_uni.ttf');
}
@font-face {
    font-family: ArialCYR;
    src: url('FONTS_DIR_PLACEHOLDER/arial_bold.ttf');
    font-weight: bold;
}
@font-face {
    font-family: ArialCYR;
    src: url('FONTS_DIR_PLACEHOLDER/arial_italic.ttf');
    font-style: italic;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: ArialCYR, Arial, sans-serif; font-size: 9pt; color: #000; background: #fff; }
.inv-block { border: 1px solid #aaa; padding: 5mm 4mm; }
.inv-top { width: 100%; margin-bottom: 1mm; font-size: 8.5pt; overflow: hidden; }
.city { }
.inv-date { font-style: italic; float: right; }
.copy-label { font-size: 8pt; color: #555; }
.inv-title { font-size: 13pt; font-weight: bold; text-align: center;
  margin: 2mm 0 3mm; border-bottom: 2px solid #000; padding-bottom: 2mm; }
.inv-num { border-bottom: 1px solid #000; }
.meta-tbl { width: 100%; border: none; margin-bottom: 2mm; }
.meta-tbl td { border: none; padding: 0.8mm 0; font-size: 8.5pt; }
.ml { width: 28mm; color: #333; }
.mv { border-bottom: 1px solid #000; }
.lines-tbl { width: 100%; border-collapse: collapse; margin-bottom: 2mm; font-size: 8.5pt; }
.lines-tbl th { background: #d8d8d8; border: 1px solid #777;
  padding: 1.5mm 1.5mm; font-size: 8pt; font-weight: bold; }
.lines-tbl td { border: 1px solid #aaa; padding: 1mm 1.5mm; }
.lines-tbl tr.subtotal td { background: #f0f0f0; border-top: 1px solid #888; }
.c { text-align: center; }
.r { text-align: right; }
.exch-section { margin-top: 2mm; }
.exch-title { font-size: 8pt; font-weight: bold; text-transform: uppercase; color: #555;
  border-top: 1px dashed #aaa; padding-top: 1.5mm; margin-bottom: 1mm; }
.total-line { font-size: 8.5pt; margin: 2mm 0 0.5mm; }
.total-box { font-size: 12pt; font-weight: bold;
  border: 2px solid #000; padding: 0.5mm 3mm; }
.kopiyky { font-size: 8pt; color: #555; margin-bottom: 3mm; }
.sigs { width: 100%; border-top: 1px solid #bbb; padding-top: 1.5mm;
  font-size: 8pt; margin-top: 2mm; overflow: hidden; }
.sig-left { float: left; width: 48%; }
.sig-right { float: right; width: 48%; text-align: right; }
</style>"""


_FONTS_DIR = Path(__file__).parent.parent / "fonts"
_FONTS_REGISTERED = False


def _register_cyrillic_fonts() -> None:
    """Реєструє шрифти з підтримкою кирилиці в ReportLab (один раз)."""
    global _FONTS_REGISTERED
    if _FONTS_REGISTERED:
        return
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.pdfbase.pdfmetrics import registerFontFamily
        pdfmetrics.registerFont(TTFont("ArialCYR",        str(_FONTS_DIR / "arial_uni.ttf")))
        pdfmetrics.registerFont(TTFont("ArialCYR-Bold",   str(_FONTS_DIR / "arial_bold.ttf")))
        pdfmetrics.registerFont(TTFont("ArialCYR-Italic", str(_FONTS_DIR / "arial_italic.ttf")))
        registerFontFamily("ArialCYR",
                           normal="ArialCYR",
                           bold="ArialCYR-Bold",
                           italic="ArialCYR-Italic",
                           boldItalic="ArialCYR-Bold")
        _FONTS_REGISTERED = True
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Font registration failed: %s", e)


def render_invoice_pdf_bytes(inv: Invoice, db: Session) -> bytes:
    """Генерує PDF-байти однієї накладної через ReportLab (для Telegram)."""
    from io import BytesIO
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER

    _register_cyrillic_fonts()

    cfg = get_settings(db)
    bakery_name = cfg.get("bakery_name", "Пекарня")
    director    = cfg.get("director", "")
    accountant  = cfg.get("accountant", "")

    client     = inv.client
    c_name     = (client.short_name or client.full_name) if client else "—"
    c_addr     = (client.address or "") if client else ""
    route_name = (client.route.name if client and client.route else "") if client else ""

    FONT      = "ArialCYR"
    FONT_BOLD = "ArialCYR-Bold"
    FONT_IT   = "ArialCYR-Italic"
    FS        = 8.0   # базовий розмір шрифту (як у паперовій накладній)

    def S(text, font=FONT, size=FS, align=TA_LEFT, color=colors.black) -> Paragraph:
        st = ParagraphStyle("s", fontName=font, fontSize=size, textColor=color,
                            alignment=align, leading=size * 1.2)
        return Paragraph(str(text), st)

    # Вузький формат — контент ~116мм як у паперовому друку (half A4 landscape мінус поля)
    PAGE_W, PAGE_H = 124*mm, 210*mm
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=(PAGE_W, PAGE_H),
                            leftMargin=4*mm, rightMargin=4*mm,
                            topMargin=5*mm, bottomMargin=5*mm)
    W = PAGE_W - 8*mm  # ширина контенту

    story = []

    LBL = colors.HexColor("#444444")

    # ── Шапка ────────────────────────────────────────────────────────────────
    header_tbl = Table(
        [[S(f"<b>{route_name}</b>", font=FONT_BOLD, size=FS),
          S(ua_date(inv.invoice_date), font=FONT_IT, size=FS, align=TA_RIGHT)]],
        colWidths=[W * 0.6, W * 0.4],
    )
    header_tbl.setStyle(TableStyle([
        ("TOPPADDING", (0,0),(-1,-1), 0), ("BOTTOMPADDING", (0,0),(-1,-1), 1)
    ]))
    story.append(header_tbl)
    story.append(HRFlowable(width=W, thickness=0.5, color=colors.grey))
    story.append(Spacer(1, 1.5*mm))

    # ── Назва ─────────────────────────────────────────────────────────────────
    story.append(S(f"Накладна № {inv.invoice_number}", font=FONT_BOLD, size=11, align=TA_CENTER))
    story.append(HRFlowable(width=W, thickness=1.5, color=colors.black))
    story.append(Spacer(1, 1.5*mm))

    # ── Мета ─────────────────────────────────────────────────────────────────
    meta_data = [
        [S("Від кого:", size=FS, color=LBL), S(f"<b>{bakery_name}</b>", font=FONT_BOLD, size=FS)],
        [S("Кому:",     size=FS, color=LBL), S(f"<b>{c_name}</b>",      font=FONT_BOLD, size=FS)],
        [S("Через:",    size=FS, color=LBL), S(c_addr, size=FS)],
        [S("Дов. №:",   size=FS, color=LBL), S("__________  від  __________", size=FS)],
    ]
    # Права колонка = тільки скільки потрібно тексту (решта ширина сторінки)
    meta_tbl = Table(meta_data, colWidths=[20*mm, W - 20*mm])
    meta_tbl.setStyle(TableStyle([
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0.8),
        ("TOPPADDING",    (0, 0), (-1, -1), 0.8),
        ("LEFTPADDING",   (0, 0), (-1, -1), 0),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.black),  # підкреслення під кожним рядком
        ("LINEBELOW", (0, -1), (-1, -1), 0, colors.white),   # але не під останнім
        ("INNERGRID", (0, 0), (-1, -1), 0, colors.white),    # без вертикальних ліній
        ("BOX",       (0, 0), (-1, -1), 0, colors.white),    # без рамки
    ]))
    story.append(meta_tbl)
    story.append(Spacer(1, 1.5*mm))

    # ── Таблиця товарів ───────────────────────────────────────────────────────
    from backend.models.references import Category as CatModel
    all_cats = {c.id: c for c in db.query(CatModel).all()}
    main_lines = [l for l in inv.lines if not l.is_exchange]
    exch_lines = [l for l in inv.lines if l.is_exchange]

    groups: dict = {}
    cat_order: list = []
    for line in main_lines:
        product = db.get(Product, line.product_id)
        cid = product.category_id if product else None
        if cid not in groups:
            groups[cid] = []
            cat_order.append(cid)
        groups[cid].append((line, product))
    cat_order.sort(key=lambda cid: all_cats[cid].sort_order if cid and cid in all_cats else 999)

    HDR_BG  = colors.HexColor("#d8d8d8")
    SUB_BG  = colors.HexColor("#f0f0f0")
    BORDER  = colors.HexColor("#aaaaaa")
    # Назва | Кільк | Од | Ціна | Сума — пропорції з HTML CSS (38px/32px/54px/60px → pt: 13/9/19/21mm)
    C_QTY, C_UNIT, C_PRICE, C_SUM = 13*mm, 9*mm, 19*mm, 21*mm
    COL_W = [W - C_QTY - C_UNIT - C_PRICE - C_SUM, C_QTY, C_UNIT, C_PRICE, C_SUM]

    lines_data = [[
        S("Назва", font=FONT_BOLD, size=FS, align=TA_CENTER),
        S("Кільк.", font=FONT_BOLD, size=FS, align=TA_CENTER),
        S("Од.", font=FONT_BOLD, size=FS, align=TA_CENTER),
        S("Ціна", font=FONT_BOLD, size=FS, align=TA_RIGHT),
        S("Сума", font=FONT_BOLD, size=FS, align=TA_RIGHT),
    ]]

    total_qty = 0
    total_names = 0
    for cid in cat_order:
        for line, product in groups[cid]:
            p_name    = product.name if product else f"#{line.product_id}"
            unit      = product.unit.name if product and product.unit else "шт"
            eff_price = line.price_override if line.price_override else line.price
            total_qty    += line.qty
            total_names  += 1
            lines_data.append([
                S(p_name, size=FS),
                S(f"{line.qty:g}", size=FS, align=TA_CENTER),
                S(unit, size=FS, align=TA_CENTER),
                S(fmt(eff_price), size=FS, align=TA_RIGHT),
                S(fmt(line.sum), size=FS, align=TA_RIGHT),
            ])
        cat_label = all_cats[cid].name if cid and cid in all_cats else "Інше"
        g_sum = sum(l.sum for l, _ in groups[cid])
        lines_data.append([
            S(f"Сума по  <b>{cat_label}</b>", font=FONT_BOLD, size=FS, align=TA_RIGHT),
            S(""), S(""), S(""),
            S(f"<b>{fmt(g_sum)}</b>", font=FONT_BOLD, size=FS, align=TA_RIGHT),
        ])

    lines_tbl = Table(lines_data, colWidths=COL_W, repeatRows=1)
    base_style = [
        ("BACKGROUND",  (0, 0), (-1, 0), HDR_BG),
        ("GRID",        (0, 0), (-1, 0), 0.5, colors.HexColor("#777777")),
        ("BOX",         (0, 0), (-1, -1), 0.5, BORDER),
        ("INNERGRID",   (0, 1), (-1, -1), 0.5, BORDER),
        ("TOPPADDING",    (0, 0), (-1, -1), 1.2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.2),
        ("LEFTPADDING",   (0, 0), (-1, -1), 1.5),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 1.5),
    ]
    # Subtotal rows (last row of each group)
    row = 1
    for cid in cat_order:
        row += len(groups[cid])
        base_style.append(("BACKGROUND",  (0, row), (-1, row), SUB_BG))
        base_style.append(("SPAN",        (0, row), (3, row)))
        # Прибираємо вертикальні лінії всередині заспаненого діапазону
        base_style.append(("LINEAFTER",   (0, row), (2, row), 0, colors.white))
        row += 1
    lines_tbl.setStyle(TableStyle(base_style))
    story.append(lines_tbl)

    # Обмін (якщо є)
    if exch_lines:
        story.append(Spacer(1, 1.5*mm))
        story.append(HRFlowable(width=W, thickness=0.5, color=colors.grey, dash=(3, 3)))
        story.append(S("ОБМІН", font=FONT_BOLD, size=6.5, color=colors.HexColor("#555555")))
        exch_data = [[S("Назва", font=FONT_BOLD, size=FS),
                      S("Кільк.", font=FONT_BOLD, size=FS, align=TA_CENTER),
                      S("Од.", font=FONT_BOLD, size=FS, align=TA_CENTER),
                      S("Ціна", font=FONT_BOLD, size=FS, align=TA_RIGHT),
                      S("Сума", font=FONT_BOLD, size=FS, align=TA_RIGHT)]]
        exch_total = 0.0
        for line in exch_lines:
            product   = db.get(Product, line.product_id)
            p_name    = product.name if product else f"#{line.product_id}"
            unit      = product.unit.name if product and product.unit else "шт"
            eff_price = line.price_override if line.price_override else line.price
            exch_total += line.sum
            exch_data.append([S(p_name, size=FS), S(f"{line.qty:g}", size=FS, align=TA_CENTER),
                               S(unit, size=FS, align=TA_CENTER),
                               S(fmt(eff_price), size=FS, align=TA_RIGHT),
                               S(fmt(line.sum), size=FS, align=TA_RIGHT)])
        exch_data.append([S("Сума обміну", size=FS, align=TA_RIGHT), S(""), S(""), S(""),
                          S(f"<b>{fmt(exch_total)}</b>", font=FONT_BOLD, size=FS, align=TA_RIGHT)])
        exch_tbl = Table(exch_data, colWidths=COL_W)
        exch_tbl.setStyle(TableStyle([
            ("BACKGROUND",  (0, 0), (-1, 0), HDR_BG),
            ("BOX",         (0, 0), (-1, -1), 0.5, BORDER),
            ("INNERGRID",   (0, 0), (-1, -1), 0.5, BORDER),
            ("BACKGROUND",  (0, -1), (-1, -1), SUB_BG),
            ("SPAN",        (0, -1), (3, -1)),
            ("TOPPADDING",  (0, 0), (-1, -1), 1.5),
            ("BOTTOMPADDING",(0, 0), (-1, -1), 1.5),
        ]))
        story.append(exch_tbl)

    # ── Підсумок ──────────────────────────────────────────────────────────────
    story.append(Spacer(1, 1.5*mm))
    total_tbl = Table([[
        S(f"Усього  <b>{total_names}</b>  найменувань,  <b>{total_qty:g}</b>  штук, на суму:", size=FS),
        S(f"<b>{fmt(inv.total_sum)}</b>", font=FONT_BOLD, size=11, align=TA_CENTER),
    ]], colWidths=[W - 36*mm, 36*mm])
    total_tbl.setStyle(TableStyle([
        ("BOX",    (1, 0), (1, 0), 1.5, colors.black),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",    (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    story.append(total_tbl)
    story.append(S("грн. ____ коп.", size=6.5, color=colors.HexColor("#555555")))
    story.append(Spacer(1, 2*mm))

    # ── Підписи ───────────────────────────────────────────────────────────────
    sig_style = [
        ("LINEABOVE", (0, 0), (-1, 0), 0.5, colors.HexColor("#bbbbbb")),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]
    sigs1 = Table([[
        S(f"Директор:  <i>{director or '________________'}</i>", font=FONT_IT, size=FS),
        S(f"Бухгалтер:  <i>{accountant or '________________'}</i>", font=FONT_IT, size=FS, align=TA_RIGHT),
    ]], colWidths=[W * 0.5, W * 0.5])
    sigs1.setStyle(TableStyle(sig_style))
    story.append(sigs1)
    sigs2 = Table([[
        S("Прийняв:  ________________", size=FS),
        S("Відпускає:  <i>Диспетчер</i>", font=FONT_IT, size=FS, align=TA_RIGHT),
    ]], colWidths=[W * 0.5, W * 0.5])
    sigs2.setStyle(TableStyle([("TOPPADDING", (0, 0), (-1, -1), 1)]))
    story.append(sigs2)

    doc.build(story)
    return buf.getvalue()


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
def print_baking(task_date: str, category_id: Optional[int] = None, db: Session = Depends(get_db)):
    import math
    tasks = (
        db.query(BakingTask)
        .filter(BakingTask.task_date == task_date)
        .order_by(BakingTask.product_id)
        .all()
    )

    # Всі категорії-відділи що випікають (is_baked=1), відсортовані
    all_cats: dict[int, Category] = {
        c.id: c for c in db.query(Category).filter(Category.is_baked == 1).order_by(Category.sort_order, Category.name).all()
    }

    # Якщо завдання ще не сформовані — рахуємо з замовлень на льоту (без збереження)
    if not tasks:
        aggregated = aggregate_for_baking(db, task_date)
        if not aggregated:
            raise HTTPException(status_code=404, detail="Замовлень на цю дату не знайдено")

        from types import SimpleNamespace
        tasks = []
        for row in aggregated:
            product = db.get(Product, row["product_id"])
            if not product:
                continue
            cat = all_cats.get(product.category_id) if product.category_id else None
            if not cat:
                continue  # пропускаємо невипечені категорії
            reserve_pct = cat.reserve_pct or 0
            tasks.append(SimpleNamespace(
                product_id      = row["product_id"],
                ordered_qty     = row["ordered_qty"],
                recommended_qty = math.ceil(row["ordered_qty"] * (1 + reserve_pct / 100)),
                baked_qty       = 0,
            ))

    cfg         = get_settings(db)
    bakery_name = cfg.get("bakery_name", "Пекарня")

    # Групуємо завдання по category_id (тільки is_baked категорії)
    groups: dict[int, list[BakingTask]] = {}
    for task in tasks:
        product = db.get(Product, task.product_id)
        if not product or not product.category_id:
            continue
        cid = product.category_id
        if cid not in all_cats:
            continue  # пропускаємо невипечені
        groups.setdefault(cid, []).append(task)

    # Які категорії друкувати
    cats_to_render = [all_cats[category_id]] if category_id and category_id in all_cats else list(all_cats.values())

    if category_id and category_id not in groups:
        cat_name = all_cats[category_id].name if category_id in all_cats else str(category_id)
        raise HTTPException(status_code=404, detail=f"Завдань на випічку ({cat_name}) на {task_date} немає")

    groups_html = ""
    for cat in cats_to_render:
        group = groups.get(cat.id, [])
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
        <div class="section-title">{cat.name}</div>
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


# ─── Звіт випічки (результат дня) ────────────────────────────────────────────

@router.get("/baking-report", response_class=HTMLResponse)
def print_baking_report(task_date: str, db: Session = Depends(get_db)):
    """Друкований звіт результатів випічки: категорії + компактні розбіжності."""
    from backend.models.orders import Order
    from backend.models.references import Client

    tasks = (
        db.query(BakingTask)
        .filter(BakingTask.task_date == task_date)
        .order_by(BakingTask.product_id)
        .all()
    )
    if not tasks:
        raise HTTPException(status_code=404, detail="Завдань на цю дату не знайдено")

    entered = [t for t in tasks if t.baked_qty is not None]
    if not entered:
        raise HTTPException(status_code=404, detail="Кількість 'Спечено' ще не введено жодного виробу")

    all_cats: dict[int, Category] = {
        c.id: c for c in db.query(Category)
        .filter(Category.is_baked == 1)
        .order_by(Category.sort_order, Category.name)
        .all()
    }

    surplus_orders = (
        db.query(Order)
        .filter(Order.order_date == task_date, Order.origin_id == 0)
        .all()
    )
    underbaked_client = db.query(Client).filter(Client.client_kind == "underbaked").first()
    shortage_children: list = []
    if underbaked_client:
        shortage_children = (
            db.query(Order)
            .filter(
                Order.order_date == task_date,
                Order.client_id == underbaked_client.id,
                Order.parent_order_id.isnot(None),
            )
            .all()
        )

    cfg = get_settings(db)
    bakery_name = cfg.get("bakery_name", "Пекарня")

    def cname(client_id: int) -> str:
        c = db.get(Client, client_id)
        return (c.short_name or c.full_name) if c else f"#{client_id}"

    # ── Розбіжності: обчислення (потрібне і для таблиць категорій) ────────────
    surplus_by_pid: dict[int, list] = {}
    for o in surplus_orders:
        surplus_by_pid.setdefault(o.product_id, []).append(o)

    shortage_by_product: dict[int, list] = {}
    for o in shortage_children:
        if not o.parent_order_id:
            continue
        parent = db.get(Order, o.parent_order_id)
        if not parent:
            continue
        shortage_by_product.setdefault(parent.product_id, []).append((o, parent))

    discrepant = [
        (task, db.get(Product, task.product_id))
        for task in entered
        if (task.baked_qty or 0) != task.ordered_qty
           or task.product_id in surplus_by_pid
           or task.product_id in shortage_by_product
    ]
    discrepant = [(t, p) for t, p in discrepant if p and p.category_id in all_cats]

    def dev_html(pid: int, diff: float) -> str:
        """Клітинка Відхил.: іконка фінального стану + значення в дужках."""
        if diff == 0:
            return '<span class="dv-icon rok">✓</span>'
        s_alloc  = sum(o.qty for o in surplus_by_pid.get(pid, []))
        s_reduc  = sum(c.qty for c, _ in shortage_by_product.get(pid, []))
        if diff > 0:
            resolved = s_alloc >= diff
            icon, cls, val = ("✓", "rok", f"+{diff:g}") if resolved else ("↗", "rp", f"+{diff:g}")
        else:
            resolved = s_reduc >= abs(diff)
            icon, cls, val = ("✓", "rok", f"{diff:g}") if resolved else ("✂", "rm", f"{diff:g}")
        return f'<span class="dv-icon {cls}">{icon}</span><span class="dv-val {cls}">({val})</span>'

    # Групуємо завдання по категорії
    groups: dict[int, list] = {}
    for task in entered:
        product = db.get(Product, task.product_id)
        if not product or not product.category_id:
            continue
        if product.category_id not in all_cats:
            continue
        groups.setdefault(product.category_id, []).append((task, product))

    # ── Таблиці категорій ──────────────────────────────────────────────────────
    cats_html = ""
    for cat in all_cats.values():
        group = groups.get(cat.id)
        if not group:
            continue
        rows_html = ""
        total_ord = total_baked = 0.0
        for task, product in group:
            baked = task.baked_qty or 0
            diff  = baked - task.ordered_qty
            total_ord   += task.ordered_qty
            total_baked += baked
            rows_html += f"""
        <tr>
          <td>{product.name}</td>
          <td class="r">{task.ordered_qty:g}</td>
          <td class="r"><b>{baked:g}</b></td>
          <td class="dv">{dev_html(task.product_id, diff)}</td>
        </tr>"""
        total_diff = total_baked - total_ord
        cats_html += f"""
      <div class="section-title section-header">
        <span>{cat.name.upper()}</span>
        <span class="section-sig">Пекар: ________________</span>
      </div>
      <table class="baking-tbl">
        <thead>
          <tr>
            <th>Виріб</th>
            <th class="r" style="width:70px">Замовлено</th>
            <th class="r" style="width:70px">Спечено</th>
            <th class="dv" style="width:62px">Відхил.</th>
          </tr>
        </thead>
        <tbody>{rows_html}</tbody>
        <tfoot>
          <tr>
            <td><b>Разом</b></td>
            <td class="r">{total_ord:g}</td>
            <td class="r">{total_baked:g}</td>
            <td class="dv">{dev_html(0, total_diff)}</td>
          </tr>
        </tfoot>
      </table>"""

    disc_rows = ""
    for task, product in discrepant:
        baked = task.baked_qty or 0
        diff  = baked - task.ordered_qty
        surplus_lines  = surplus_by_pid.get(task.product_id, [])
        shortage_lines = shortage_by_product.get(task.product_id, [])
        surplus_alloc  = sum(o.qty for o in surplus_lines)
        shortage_reduc = sum(child.qty for child, _parent in shortage_lines)

        # Фінальний стан продукту
        if diff > 0:
            is_resolved  = surplus_alloc >= diff
            state_icon   = "✓" if is_resolved else "↗"
            state_cls    = "rok" if is_resolved else "rp"
            diff_label   = f'Надлишок: +{diff:g}'
        elif diff < 0:
            is_resolved  = shortage_reduc >= abs(diff)
            state_icon   = "✓" if is_resolved else "✂"
            state_cls    = "rok" if is_resolved else "rm"
            diff_label   = f'Нестача: {diff:g}'
        else:
            state_icon, state_cls, diff_label = "✓", "rok", ""

        disc_rows += f"""
        <tr class="dh">
          <td class="icon-col"><span class="{state_cls}">{state_icon}</span></td>
          <td colspan="2"><b>{product.name}</b>{"&nbsp; " + diff_label if diff_label else ""}</td>
        </tr>"""

        for o in surplus_lines:
            note = f" &mdash; {o.notes}" if o.notes else ""
            disc_rows += f"""
        <tr class="dd">
          <td class="icon-col"><span class="rp">↗</span></td>
          <td>{cname(o.client_id)}{note}</td>
          <td class="r">(+{o.qty:g})</td>
        </tr>"""

        for child, parent in shortage_lines:
            disc_rows += f"""
        <tr class="dd">
          <td class="icon-col"><span class="rm">✂</span></td>
          <td>{cname(parent.client_id)}</td>
          <td class="r">(−{child.qty:g})</td>
        </tr>"""

    disc_section = f"""
      <div class="section-title">РОЗБІЖНОСТІ</div>
      <table class="baking-tbl dt">
        <colgroup>
          <col style="width:22px">
          <col>
          <col style="width:60px">
        </colgroup>
        <tbody>{disc_rows}</tbody>
      </table>""" if disc_rows else """
      <div class="section-title">РОЗБІЖНОСТІ</div>
      <p style="font-size:9pt;color:#555;margin:4px 0 10px;">
        Розбіжностей немає — випічка точно відповідає замовленням.</p>"""

    html = f"""<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="UTF-8">
  <title>Звіт випічки {task_date}</title>
  {BASE_CSS}
  <style>
    @media print  {{ @page {{ size: A4 portrait; margin: 8mm; }} }}
    @media screen {{ .baking-wrap {{ max-width: 680px; }} }}
    .rp  {{ color:#1a6a30;font-weight:bold; }}
    .rm  {{ color:#b00;font-weight:bold; }}
    .rok {{ color:#1a6a30; }}
    .dh td {{ background:#f0f4f8;padding:3px 6px;border-top:1px solid #aaa;font-size:9pt; }}
    .dd td {{ font-size:8.5pt;padding:2px 6px;border-bottom:1px solid #ebebeb;color:#333;padding-left:28px!important; }}
    .dd td.icon-col {{ padding-left:4px!important; }}
    .dt    {{ margin-bottom:6px; }}
    .icon-col {{ width:22px;text-align:center;padding-left:4px!important;padding-right:2px!important; }}
    .section-header {{ display:flex;justify-content:space-between;align-items:baseline; }}
    .section-sig {{ font-size:8.5pt;font-weight:normal;color:#333; }}
    .dv {{ text-align:left;padding-left:6px!important; }}
    .dv-icon {{ display:inline-block;width:14px;text-align:center;font-weight:bold; }}
    .dv-val {{ font-size:8.5pt; }}
  </style>
</head>
<body>
{PRINT_BTN}
<div class="baking-wrap">
  <div class="baking-header">
    <div>
      <div style="font-size:13pt;font-weight:bold;">{bakery_name}</div>
      <div style="font-size:11pt;font-weight:bold;margin-top:4px;">Звіт випічки</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:12pt;font-weight:bold;">{ua_date(task_date)}</div>
      <div style="font-size:8.5pt;margin-top:8px;">Оператор: ________________</div>
    </div>
  </div>
  {cats_html}
  {disc_section}
</div>
</body>
</html>"""
    return HTMLResponse(content=html)


# ─── Денний звіт пекарні ─────────────────────────────────────────────────────

def _dr_section1(db: Session, date: str) -> str:
    """Секція 1: продукція — замовлено/спечено/обмін/магазин по категоріях."""
    # Замовлено: з orders напряму (всі клієнти крім магазину/системних)
    SYSTEM_KINDS = ("shop", "writeoff", "ration", "underbaked")
    ordered_rows = (
        db.query(Order.product_id, func.sum(Order.qty).label("ord"))
        .join(Client, Order.client_id == Client.id)
        .filter(
            Order.order_date == date,
            Order.origin_id.is_(None),
            Order.parent_order_id.is_(None),
            Order.exchange_type == "none",
            Order.price_override.is_(None),
            Client.client_kind.notin_(SYSTEM_KINDS),
        )
        .group_by(Order.product_id)
        .all()
    )
    ordered: dict[int, float] = {r.product_id: (r.ord or 0.0) for r in ordered_rows}

    # Спечено: з baking_tasks (якщо завдання не генерувались — буде порожньо)
    tasks = {
        bt.product_id: bt
        for bt in db.query(BakingTask).filter(BakingTask.task_date == date).all()
    }

    # Обмін: qty з orders де exchange_type != 'none'
    # (exchange_qty не завжди заповнений — використовуємо qty доставленого товару)
    exchange_rows = (
        db.query(Order.product_id, func.sum(Order.qty).label("exc"))
        .join(Client, Order.client_id == Client.id)
        .filter(
            Order.order_date == date,
            Order.exchange_type != "none",
            Order.origin_id.is_(None),
            Client.client_kind.notin_(SYSTEM_KINDS),
        )
        .group_by(Order.product_id)
        .all()
    )
    exchanges: dict[int, float] = {r.product_id: (r.exc or 0.0) for r in exchange_rows}

    # Магазин: qty orders де client_kind='shop'
    shop_rows = (
        db.query(Order.product_id, func.sum(Order.qty).label("sq"))
        .join(Client, Order.client_id == Client.id)
        .filter(Order.order_date == date, Client.client_kind == "shop")
        .group_by(Order.product_id)
        .all()
    )
    to_shop: dict[int, float] = {r.product_id: (r.sq or 0.0) for r in shop_rows}

    all_pids = set(ordered) | set(tasks) | set(exchanges) | set(to_shop)
    if not all_pids:
        return "<p style='color:#888;font-size:9pt;'>— Даних про продукцію немає —</p>"

    products_map = {p.id: p for p in db.query(Product).filter(Product.id.in_(all_pids)).all()}
    cats_map     = {c.id: c for c in db.query(Category).filter(Category.is_baked == 1).all()}

    by_cat: dict[int, list] = {}
    for pid in all_pids:
        p = products_map.get(pid)
        if not p or not p.category_id or p.category_id not in cats_map:
            continue
        by_cat.setdefault(p.category_id, []).append(pid)

    if not by_cat:
        return "<p style='color:#888;font-size:9pt;'>— Даних про продукцію немає —</p>"

    html = ""
    for cat_id in sorted(by_cat, key=lambda cid: cats_map[cid].sort_order):
        cat  = cats_map[cat_id]
        pids = sorted(by_cat[cat_id], key=lambda pid: products_map[pid].name)
        tot_ord = tot_bak = tot_exc = tot_shop = 0.0
        rows_html = ""
        for pid in pids:
            bt      = tasks.get(pid)
            ord_qty = ordered.get(pid, 0.0)
            baked   = (bt.baked_qty if bt and bt.baked_qty is not None else ord_qty)
            exc     = exchanges.get(pid, 0.0)
            shop    = to_shop.get(pid, 0.0)
            tot_ord += ord_qty; tot_bak += baked; tot_exc += exc; tot_shop += shop
            pname   = products_map[pid].name
            rows_html += f"""
      <tr>
        <td>{pname}</td>
        <td class="dr-num">{fmt(ord_qty) if ord_qty else "—"}</td>
        <td class="dr-num">{fmt(baked)   if baked   else "—"}</td>
        <td class="dr-num">{fmt(exc)     if exc     else "—"}</td>
        <td class="dr-num">{fmt(shop)    if shop    else "—"}</td>
      </tr>"""
        html += f"""
  <div class="dr-cat-title">{cat.name.upper()}</div>
  <table class="dr-table">
    <thead>
      <tr>
        <th>Виріб</th><th class="dr-num">Замовлено</th>
        <th class="dr-num">Спечено</th><th class="dr-num">Обмін</th>
        <th class="dr-num">Магазин</th>
      </tr>
    </thead>
    <tbody>{rows_html}
      <tr class="dr-total">
        <td>Разом</td>
        <td class="dr-num">{fmt(tot_ord)}</td>
        <td class="dr-num">{fmt(tot_bak)}</td>
        <td class="dr-num">{fmt(tot_exc)}</td>
        <td class="dr-num">{fmt(tot_shop)}</td>
      </tr>
    </tbody>
  </table>"""
    return html


def _dr_section2(db: Session, date: str) -> str:
    """Секція 2: агрегація по маршрутах із накладних + обміни з orders."""
    all_cats = {c.id: c for c in db.query(Category).filter(Category.is_baked == 1).all()}
    invoices_list = (
        db.query(Invoice)
        .filter(Invoice.invoice_date == date, Invoice.status != "cancelled")
        .all()
    )
    if not invoices_list:
        return "<p style='color:#888;font-size:9pt;'>— Накладних за цей день немає —</p>"

    routes_map   = {r.id: r for r in db.query(Route).filter(Route.is_active == 1).all()}
    all_pids     = {ln.product_id for inv in invoices_list for ln in inv.lines}
    products_map = {p.id: p for p in db.query(Product).filter(Product.id.in_(all_pids)).all()} if all_pids else {}

    agg: dict[int, dict] = {}
    for inv in invoices_list:
        rid = inv.route_id or 0
        if rid not in agg:
            agg[rid] = {"sum": 0.0, "cats": {}}
        for ln in inv.lines:
            prod   = products_map.get(ln.product_id)
            cat_id = prod.category_id if prod else None
            if cat_id and cat_id not in all_cats:
                cat_id = None
            agg[rid]["cats"].setdefault(cat_id, {"qty": 0.0, "exch": 0.0})
            # is_exchange=1 рядки — артефакт імпорту: в реальних даних не заповнені.
            # Обміни читаємо окремо з orders нижче.
            agg[rid]["cats"][cat_id]["qty"] += ln.qty
            agg[rid]["sum"] += ln.sum

    # Обміни: з orders де exchange_type != 'none', групуємо по route клієнта
    SYSTEM_KINDS = ("shop", "writeoff", "ration", "underbaked")
    exch_order_rows = (
        db.query(
            Client.route_id.label("rid"),
            Order.product_id,
            func.sum(Order.qty).label("exc"),
        )
        .join(Client, Order.client_id == Client.id)
        .filter(
            Order.order_date == date,
            Order.exchange_type != "none",
            Order.origin_id.is_(None),
            Client.client_kind.notin_(SYSTEM_KINDS),
        )
        .group_by(Client.route_id, Order.product_id)
        .all()
    )
    # Завантажуємо продукти обмінів яких може не бути в products_map
    exch_pids = {r.product_id for r in exch_order_rows} - set(products_map)
    if exch_pids:
        products_map.update({p.id: p for p in db.query(Product).filter(Product.id.in_(exch_pids)).all()})
    for row in exch_order_rows:
        rid    = row.rid or 0
        prod   = products_map.get(row.product_id)
        cat_id = prod.category_id if prod else None
        if cat_id and cat_id not in all_cats:
            cat_id = None
        agg.setdefault(rid, {"sum": 0.0, "cats": {}})
        agg[rid]["cats"].setdefault(cat_id, {"qty": 0.0, "exch": 0.0})
        agg[rid]["cats"][cat_id]["exch"] += (row.exc or 0.0)

    used_cats = sorted(
        {cid for rd in agg.values() for cid in rd["cats"] if cid and cid in all_cats},
        key=lambda cid: all_cats[cid].sort_order,
    )

    cat_headers = "".join(
        f'<th class="dr-num">{all_cats[cid].name}</th><th class="dr-num">Обм.</th>'
        for cid in used_cats
    )
    thead = f'<tr><th>Маршрут</th>{cat_headers}<th class="dr-num">Сума</th></tr>'

    tot_cats: dict = {cid: {"qty": 0.0, "exch": 0.0} for cid in used_cats}
    tot_sum   = 0.0
    rows_html = ""

    for rid in sorted(agg, key=lambda r: routes_map.get(r, Route()).sort_order if r in routes_map else 999):
        rd    = agg[rid]
        rname = routes_map[rid].name if rid in routes_map else "—"
        cells = ""
        for cid in used_cats:
            q  = rd["cats"].get(cid, {}).get("qty",  0.0)
            ex = rd["cats"].get(cid, {}).get("exch", 0.0)
            tot_cats[cid]["qty"]  += q
            tot_cats[cid]["exch"] += ex
            cells += f'<td class="dr-num">{fmt(q) if q else "—"}</td>'
            cells += f'<td class="dr-num">{fmt(ex) if ex else "—"}</td>'
        tot_sum += rd["sum"]
        rows_html += f'<tr><td>{rname}</td>{cells}<td class="dr-num dr-money">{fmt(rd["sum"])}</td></tr>'

    tot_cells = "".join(
        f'<td class="dr-num">{fmt(tot_cats[cid]["qty"])}</td>'
        f'<td class="dr-num">{fmt(tot_cats[cid]["exch"])}</td>'
        for cid in used_cats
    )
    rows_html += f'<tr class="dr-total"><td>Разом</td>{tot_cells}<td class="dr-num dr-money">{fmt(tot_sum)}</td></tr>'

    return f'<table class="dr-table"><thead>{thead}</thead><tbody>{rows_html}</tbody></table>'


def _dr_section3(db: Session, date: str) -> str:
    """Секція 3: фінансовий підсумок дня."""
    # Завантажуємо всі статті — потрібні і для сьогоднішніх записів,
    # і для коректного виключення "Накладна" з історичного підрахунку каси.
    all_arts: dict[int, FinanceArticle] = {a.id: a for a in db.query(FinanceArticle).all()}
    invoice_art_ids = {aid for aid, a in all_arts.items() if a.name == "Накладна"}

    def _is_invoice_entry(e: Finance) -> bool:
        """True якщо запис є бухгалтерською накладною (не рухом готівки)."""
        if e.article_id:
            return e.article_id in invoice_art_ids
        return False

    # ── Залишок в касі на початок дня (всі не-накладні до цієї дати) ──────────
    prev_q = db.query(func.sum(Finance.amount * Finance.sign)).filter(
        Finance.finance_date < date,
    )
    if invoice_art_ids:
        prev_q = prev_q.filter(
            (Finance.article_id.is_(None)) | Finance.article_id.notin_(invoice_art_ids)
        )
    prev_balance = round((prev_q.scalar() or 0.0), 2)

    # ── Записи поточного дня ───────────────────────────────────────────────────
    entries = db.query(Finance).filter(Finance.finance_date == date).all()

    if not entries:
        prev_cls = "dr-income" if prev_balance >= 0 else "dr-expense"
        prev_row = (
            f'<tr><td>Залишок на початок дня</td>'
            f'<td class="dr-num {prev_cls} dr-money">{fmt(prev_balance)}&nbsp;грн</td></tr>'
            f'<tr><td><strong>Залишок в касі</strong></td>'
            f'<td class="dr-num {prev_cls} dr-money"><strong>{fmt(prev_balance)}&nbsp;грн</strong></td></tr>'
        ) if prev_balance else ""
        if prev_row:
            return f'<table class="dr-table dr-fin-total-table"><tbody>{prev_row}</tbody></table>'
        return "<p style='color:#888;font-size:9pt;'>— Фінансових операцій немає —</p>"

    arts_map = all_arts  # псевдонім для лаконічності нижче

    by_article: dict[tuple, dict] = {}
    for e in entries:
        art      = arts_map.get(e.article_id) if e.article_id else None
        nc       = art.needs_client if art else (1 if e.client_id else 0)
        art_name = art.name if art else (e.finance_type or "Інше")
        key      = (nc, e.article_id or e.finance_type)
        if key not in by_article:
            by_article[key] = {"name": art_name, "needs_client": nc, "total": 0.0}
        by_article[key]["total"] = round(by_article[key]["total"] + e.amount * e.sign, 2)

    client_rows = [(v["name"], v["total"]) for (nc, _), v in by_article.items() if nc == 1]
    cash_rows   = [(v["name"], v["total"]) for (nc, _), v in by_article.items() if nc == 0]

    def _rows_html(rows: list) -> str:
        h = ""
        for name, total in sorted(rows, key=lambda x: -abs(x[1])):
            sign_cls = "dr-income" if total >= 0 else "dr-expense"
            sign_chr = "+" if total >= 0 else "−"
            h += (f'<tr><td>{name}</td>'
                  f'<td class="dr-num {sign_cls}">{sign_chr}&nbsp;{fmt(abs(total))}&nbsp;грн</td></tr>')
        return h

    # Борг клієнтів = сума клієнтських операцій дня (накладні мінус оплати)
    client_net = round(sum(t for _, t in client_rows), 2)

    # Рух готівки за день (всі не-накладні)
    today_cash_flow = round(sum(e.amount * e.sign for e in entries if not _is_invoice_entry(e)), 2)

    # Підсумковий залишок в касі
    cash_balance = round(prev_balance + today_cash_flow, 2)

    # ── Сортування рядків ─────────────────────────────────────────────────────
    def _client_order(name: str) -> int:
        n = name.lower()
        if "накладна" in n:   return 0
        if "оплата"   in n:   return 1
        return 2  # корекція, списання, інші

    def _cash_order(name: str) -> int:
        if "виведення" in name.lower():  return 99  # завжди останнє
        return 0

    client_sorted = sorted(client_rows, key=lambda x: (_client_order(x[0]), -abs(x[1])))
    cash_sorted   = sorted(cash_rows,   key=lambda x: (_cash_order(x[0]),   -abs(x[1])))

    def _row(name: str, total: float, bold: bool = False) -> str:
        sign_cls = "dr-income" if total >= 0 else "dr-expense"
        sign_chr = "+" if total >= 0 else "−"
        n = f"<strong>{name}</strong>" if bold else name
        v = f"<strong>{fmt(abs(total))}</strong>" if bold else fmt(abs(total))
        return (f'<tr><td>{n}</td>'
                f'<td class="dr-num {sign_cls}">{sign_chr}&nbsp;{v}&nbsp;грн</td></tr>')

    client_html = "".join(_row(n, t) for n, t in client_sorted) or "<tr><td colspan='2' style='color:#888'>—</td></tr>"
    cash_html   = "".join(_row(n, t) for n, t in cash_sorted)   or "<tr><td colspan='2' style='color:#888'>—</td></tr>"

    # ── Рядок борг/переплата (3.2 підсумок) ───────────────────────────────────
    debt_cls   = "dr-income" if client_net >= 0 else "dr-expense"
    debt_chr   = "+"         if client_net >= 0 else "−"
    debt_label = "Переплата клієнтів" if client_net > 0 else "Борг клієнтів"
    debt_row = (
        f'<tr class="dr-subtotal">'
        f'<td><em>{debt_label}</em></td>'
        f'<td class="dr-num {debt_cls}"><em>{debt_chr}&nbsp;{fmt(abs(client_net))}&nbsp;грн</em></td>'
        f'</tr>'
    )

    # ── 3.1 Залишок на початок дня ────────────────────────────────────────────
    prev_cls  = "dr-income" if prev_balance >= 0 else "dr-expense"
    prev_chr  = "+"         if prev_balance >= 0 else "−"
    prev_block = (
        f'<table class="dr-table dr-fin-total-table" style="margin-bottom:10px;">'
        f'<tbody>'
        f'<tr><td>Залишок на початок дня</td>'
        f'<td class="dr-num dr-money {prev_cls}">{prev_chr}&nbsp;{fmt(abs(prev_balance))}&nbsp;грн</td></tr>'
        f'</tbody></table>'
    )

    # ── 3.4 Залишок в касі ────────────────────────────────────────────────────
    bal_cls = "dr-income" if cash_balance >= 0 else "dr-expense"
    bal_block = (
        f'<table class="dr-table dr-fin-total-table">'
        f'<tbody>'
        f'<tr><td><strong>Залишок в касі</strong></td>'
        f'<td class="dr-num dr-money {bal_cls}"><strong>{fmt(cash_balance)}&nbsp;грн</strong></td></tr>'
        f'</tbody></table>'
    )

    return f"""
  {prev_block}
  <div class="dr-fin-block">
    <div class="dr-fin-title">Клієнтські операції</div>
    <table class="dr-table dr-fin-table"><tbody>{client_html}{debt_row}</tbody></table>
  </div>
  <div class="dr-fin-block">
    <div class="dr-fin-title">Касові операції</div>
    <table class="dr-table dr-fin-table"><tbody>{cash_html}</tbody></table>
  </div>
  {bal_block}"""


@router.get("/daily-report", response_class=HTMLResponse)
def daily_report(date: str, db: Session = Depends(get_db)):
    """Денний звіт пекарні: продукція, маршрути, фінанси."""
    cfg         = get_settings(db)
    bakery_name = cfg.get("bakery_name", "Пекарня")

    s1 = _dr_section1(db, date)
    s2 = _dr_section2(db, date)
    s3 = _dr_section3(db, date)

    html = f"""<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="UTF-8">
  <title>Денний звіт {date}</title>
  {BASE_CSS}
  <style>
    @media print  {{ @page {{ size: A4 portrait; margin: 10mm 12mm; }} }}
    @media screen {{ .dr-wrap {{ max-width: 760px; margin: 0 auto; padding: 16px; }} }}
    .dr-header    {{ display:flex;justify-content:space-between;align-items:baseline;
                     border-bottom:2px solid #1a3a5c;padding-bottom:6px;margin-bottom:14px; }}
    .dr-title     {{ font-size:13pt;font-weight:bold;color:#1a3a5c; }}
    .dr-date      {{ font-size:12pt;font-weight:bold; }}
    .dr-section   {{ margin-bottom:18px; }}
    .dr-section-title {{ font-size:10.5pt;font-weight:bold;background:#1a3a5c;color:#fff;
                         padding:3px 8px;margin-bottom:6px;border-radius:3px; }}
    .dr-cat-title {{ font-size:9.5pt;font-weight:bold;color:#1a3a5c;margin:8px 0 3px;
                     border-left:3px solid #1a3a5c;padding-left:6px; }}
    .dr-table     {{ width:100%;border-collapse:collapse;font-size:9pt;margin-bottom:6px; }}
    .dr-table th  {{ background:#e8edf3;font-weight:bold;padding:4px 6px;
                     border:1px solid #bcc6d4;text-align:left; }}
    .dr-table td  {{ padding:3px 6px;border:1px solid #dde3ea; }}
    .dr-table tr:nth-child(even) td {{ background:#f7f9fb; }}
    .dr-num       {{ text-align:right;font-variant-numeric:tabular-nums; }}
    .dr-money     {{ font-weight:bold; }}
    .dr-total td  {{ background:#e8edf3!important;font-weight:bold;border-top:2px solid #9ab; }}
    .dr-income    {{ color:#1a7a30; }}
    .dr-expense   {{ color:#b00; }}
    .dr-fin-block {{ margin-bottom:10px; }}
    .dr-fin-title {{ font-size:9pt;font-weight:bold;color:#555;margin-bottom:3px; }}
    .dr-fin-table       {{ width:60%;min-width:300px; }}
    .dr-fin-total-table {{ width:60%;min-width:300px;margin-top:8px; }}
    .dr-fin-total-table td {{ padding:4px 6px;border:1px solid #bcc6d4;background:#e8edf3; }}
    .dr-subtotal td {{ background:#f5f0e8!important;border-top:1px dashed #bbb;font-size:8.5pt; }}
  </style>
</head>
<body>
{PRINT_BTN}
<div class="dr-wrap">
  <div class="dr-header">
    <div>
      <div class="dr-title">{bakery_name}</div>
      <div style="font-size:9pt;color:#555;margin-top:2px;">Денний звіт</div>
    </div>
    <div class="dr-date">{ua_date(date)}</div>
  </div>

  <div class="dr-section">
    <div class="dr-section-title">1. ПРОДУКЦІЯ</div>
    {s1}
  </div>

  <div class="dr-section">
    <div class="dr-section-title">2. МАРШРУТИ</div>
    {s2}
  </div>

  <div class="dr-section">
    <div class="dr-section-title">3. ФІНАНСИ</div>
    {s3}
  </div>
</div>
</body>
</html>"""
    return HTMLResponse(content=html)


# ═══════════════════════════════════════════════════════════════════════════════
# Загальний CSS для додаткових звітів (боргова, місячний, виписка)
# ═══════════════════════════════════════════════════════════════════════════════

_REPORT_CSS = """
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 9pt; color: #222; margin: 0; }
  @media screen { .rpt-wrap { max-width: 820px; margin: 0 auto; padding: 16px; } }
  @media print  { @page { size: A4 portrait; margin: 10mm 12mm; } }
  .rpt-header { display:flex;justify-content:space-between;align-items:baseline;
                border-bottom:2px solid #1a3a5c;padding-bottom:6px;margin-bottom:14px; }
  .rpt-title  { font-size:13pt;font-weight:bold;color:#1a3a5c; }
  .rpt-sub    { font-size:9pt;color:#555;margin-top:2px; }
  .rpt-date   { font-size:11pt;font-weight:bold; }
  .rpt-section { margin-bottom:18px; }
  .rpt-stitle { font-size:10.5pt;font-weight:bold;background:#1a3a5c;color:#fff;
                padding:3px 8px;margin-bottom:6px;border-radius:3px; }
  table.rpt   { width:100%;border-collapse:collapse;font-size:9pt;margin-bottom:4px; }
  table.rpt th { background:#e8edf3;font-weight:bold;padding:4px 6px;
                 border:1px solid #bcc6d4;text-align:left; }
  table.rpt td { padding:3px 6px;border:1px solid #dde3ea; }
  table.rpt tbody tr:nth-child(even) td { background:#f7f9fb; }
  .r    { text-align:right;font-variant-numeric:tabular-nums; }
  .c    { text-align:center; }
  .rh td   { background:#d4dbe7!important;font-weight:bold;font-size:9.5pt; }
  .rsub td { background:#eef1f7!important;font-style:italic;font-size:8.5pt; }
  .rtot td { background:#e8edf3!important;font-weight:bold;border-top:2px solid #9ab; }
  .rcat td { background:#f0f4fa!important;font-weight:bold;color:#1a3a5c; }
  .indent  { padding-left:18px!important; }
  .addr    { color:#666;font-size:8.5pt; }
  .green   { color:#1a7a30; }
  .red     { color:#b00; }
  .muted   { color:#888; }
  .no-print { }
  @media print { .no-print { display:none!important; } }
</style>"""


# ─── Боргова відомість ────────────────────────────────────────────────────────

@router.get("/debts", response_class=HTMLResponse)
def debts_report(date: str, db: Session = Depends(get_db)):
    """Боргова відомість: стан розрахунків з клієнтами станом на дату."""
    cfg = get_settings(db)
    bakery_name = cfg.get("bakery_name", "Пекарня")

    bal_rows = (
        db.query(Finance.client_id,
                 func.sum(Finance.amount * Finance.sign).label("bal"))
        .filter(Finance.client_id.isnot(None), Finance.finance_date <= date)
        .group_by(Finance.client_id)
        .all()
    )
    balances: dict[int, float] = {r.client_id: float(r.bal or 0) for r in bal_rows}

    active_ids = {cid for cid, b in balances.items() if abs(b) > 0.005}
    if not active_ids:
        return HTMLResponse(content=f"""<!DOCTYPE html><html lang="uk">
<head><meta charset="UTF-8"><title>Боргова відомість</title>{_REPORT_CSS}</head>
<body>{PRINT_BTN}<div class="rpt-wrap">
<div class="rpt-header">
  <div><div class="rpt-title">{bakery_name}</div>
  <div class="rpt-sub">Боргова відомість</div></div>
  <div class="rpt-date">Станом на {ua_date(date)}</div>
</div>
<p class="muted">— Заборгованостей і переплат не виявлено —</p>
</div></body></html>""")

    clients  = db.query(Client).filter(Client.id.in_(active_ids)).all()
    routes   = {r.id: r for r in db.query(Route).all()}

    by_route: dict[int | None, list] = {}
    for c in clients:
        by_route.setdefault(c.route_id, []).append(c)
    sorted_rids = sorted(
        by_route.keys(),
        key=lambda rid: routes[rid].sort_order if rid and rid in routes else 999,
    )

    rows_html = ""
    grand_debt = grand_credit = 0.0
    for rid in sorted_rids:
        rname    = routes[rid].name if rid and rid in routes else "Без маршруту"
        rclients = sorted(by_route[rid], key=lambda c: (c.client_group or "", c.full_name))
        r_debt   = sum(min(0.0, balances.get(c.id, 0)) for c in rclients)
        r_cred   = sum(max(0.0, balances.get(c.id, 0)) for c in rclients)
        grand_debt   += r_debt
        grand_credit += r_cred
        rows_html += (
            f'<tr class="rh"><td colspan="2">{rname}</td>'
            f'<td class="r red">{fmt(abs(r_debt)) if r_debt < -0.005 else "—"}</td>'
            f'<td class="r green">{fmt(r_cred) if r_cred > 0.005 else "—"}</td></tr>'
        )
        for c in rclients:
            bal  = balances.get(c.id, 0.0)
            name = c.short_name or c.full_name
            if bal < -0.005:
                dv, cv, dcls = fmt(abs(bal)), "", " red"
            else:
                dv, cv, dcls = "", fmt(bal), ""
            rows_html += (
                f'<tr><td class="indent">{name}</td>'
                f'<td class="addr">{c.address or ""}</td>'
                f'<td class="r{dcls}">{dv}</td>'
                f'<td class="r green">{cv}</td></tr>'
            )

    net      = grand_debt + grand_credit
    net_cls  = "red" if net < -0.005 else ("green" if net > 0.005 else "")
    net_sign = "−"   if net < -0.005 else "+"

    html = f"""<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="UTF-8">
  <title>Боргова відомість {date}</title>
  {_REPORT_CSS}
</head>
<body>
{PRINT_BTN}
<div class="rpt-wrap">
  <div class="rpt-header">
    <div>
      <div class="rpt-title">{bakery_name}</div>
      <div class="rpt-sub">Боргова відомість</div>
    </div>
    <div class="rpt-date">Станом на {ua_date(date)}</div>
  </div>
  <table class="rpt">
    <thead>
      <tr>
        <th>Клієнт</th><th>Адреса</th>
        <th class="r" style="width:120px">Борг, грн</th>
        <th class="r" style="width:120px">Переплата, грн</th>
      </tr>
    </thead>
    <tbody>
      {rows_html}
      <tr class="rtot">
        <td colspan="2"><strong>Разом</strong></td>
        <td class="r red"><strong>{fmt(abs(grand_debt)) if grand_debt < -0.005 else "0,00"}</strong></td>
        <td class="r green"><strong>{fmt(grand_credit) if grand_credit > 0.005 else "0,00"}</strong></td>
      </tr>
      <tr class="rtot">
        <td colspan="2"><strong>Нетто (переплата − борг)</strong></td>
        <td colspan="2" class="r {net_cls}">
          <strong>{net_sign}&nbsp;{fmt(abs(net))}&nbsp;грн</strong>
        </td>
      </tr>
    </tbody>
  </table>
</div>
</body>
</html>"""
    return HTMLResponse(content=html)


# ─── Місячний звіт продажів ───────────────────────────────────────────────────

@router.get("/monthly-sales", response_class=HTMLResponse)
def monthly_sales_report(year: int, month: int, db: Session = Depends(get_db)):
    """Місячний звіт: продажі по виробах, маршрутах і клієнтах."""
    cfg = get_settings(db)
    bakery_name = cfg.get("bakery_name", "Пекарня")
    month_str   = f"{year}-{month:02d}"
    month_label = f"{MONTHS_UK[month].capitalize()} {year}"

    invoices_m = (
        db.query(Invoice)
        .filter(
            func.strftime("%Y-%m", Invoice.invoice_date) == month_str,
            Invoice.status != "cancelled",
        )
        .all()
    )
    if not invoices_m:
        return HTMLResponse(content=f"""<!DOCTYPE html><html lang="uk">
<head><meta charset="UTF-8"><title>Місячний звіт {month_label}</title>{_REPORT_CSS}</head>
<body>{PRINT_BTN}<div class="rpt-wrap">
<div class="rpt-header">
  <div><div class="rpt-title">{bakery_name}</div>
  <div class="rpt-sub">Місячний звіт продажів</div></div>
  <div class="rpt-date">{month_label}</div>
</div>
<p class="muted">— Накладних за цей місяць немає —</p>
</div></body></html>""")

    all_cats     = {c.id: c for c in db.query(Category).all()}
    all_products = {p.id: p for p in db.query(Product).all()}
    all_routes   = {r.id: r for r in db.query(Route).all()}
    all_clients  = {c.id: c for c in db.query(Client).all()}
    inv_ids      = [inv.id for inv in invoices_m]

    lines = (
        db.query(InvoiceLine)
        .filter(InvoiceLine.invoice_id.in_(inv_ids), InvoiceLine.is_exchange == 0)
        .all()
    )

    # ── Секція 1: по виробах ─────────────────────────────────────────────────
    prod_agg: dict[int, dict] = {}
    for ln in lines:
        prod_agg.setdefault(ln.product_id, {"qty": 0.0, "sum": 0.0})
        prod_agg[ln.product_id]["qty"] += ln.qty
        prod_agg[ln.product_id]["sum"] += ln.sum

    cat_groups: dict[int | None, list] = {}
    for pid, agg in prod_agg.items():
        p   = all_products.get(pid)
        cid = p.category_id if p else None
        cat_groups.setdefault(cid, []).append((pid, agg, p))

    products_html = ""
    grand_qty = grand_sum_p = 0.0
    for cid in sorted(cat_groups, key=lambda c: all_cats[c].sort_order if c and c in all_cats else 999):
        cat_name = all_cats[cid].name if cid and cid in all_cats else "Без категорії"
        group    = sorted(cat_groups[cid], key=lambda x: all_products[x[0]].name if x[0] in all_products else "")
        cat_qty = cat_sum = 0.0
        for pid, agg, p in group:
            pname  = p.name if p else f"#{pid}"
            unit   = p.unit.name if p and p.unit else "шт"
            products_html += (
                f'<tr><td class="indent">{pname}</td>'
                f'<td class="c">{unit}</td>'
                f'<td class="r">{agg["qty"]:g}</td>'
                f'<td class="r">{fmt(agg["sum"])}</td></tr>'
            )
            cat_qty += agg["qty"]; cat_sum += agg["sum"]
        grand_qty += cat_qty; grand_sum_p += cat_sum
        products_html += (
            f'<tr class="rcat"><td>{cat_name} — разом</td>'
            f'<td></td><td class="r">{cat_qty:g}</td>'
            f'<td class="r">{fmt(cat_sum)}</td></tr>'
        )

    # ── Секція 2: по маршрутах ───────────────────────────────────────────────
    route_agg: dict[int | None, dict] = {}
    for inv in invoices_m:
        route_agg.setdefault(inv.route_id, {"cnt": 0, "sum": 0.0})
        route_agg[inv.route_id]["cnt"] += 1
        route_agg[inv.route_id]["sum"] += inv.total_sum

    routes_html = ""
    for rid in sorted(route_agg, key=lambda r: all_routes[r].sort_order if r and r in all_routes else 999):
        rname = all_routes[rid].name if rid and rid in all_routes else "Без маршруту"
        ragg  = route_agg[rid]
        routes_html += (
            f'<tr><td>{rname}</td>'
            f'<td class="c">{ragg["cnt"]}</td>'
            f'<td class="r">{fmt(ragg["sum"])}</td></tr>'
        )
    grand_cnt   = sum(r["cnt"] for r in route_agg.values())
    grand_sum_r = sum(r["sum"] for r in route_agg.values())

    # ── Секція 3: топ клієнти ────────────────────────────────────────────────
    client_agg: dict[int, dict] = {}
    for inv in invoices_m:
        client_agg.setdefault(inv.client_id, {"cnt": 0, "sum": 0.0})
        client_agg[inv.client_id]["cnt"] += 1
        client_agg[inv.client_id]["sum"] += inv.total_sum

    clients_html = ""
    for cid, cagg in sorted(client_agg.items(), key=lambda x: -x[1]["sum"])[:15]:
        c     = all_clients.get(cid)
        cname = (c.short_name or c.full_name) if c else f"#{cid}"
        rname = all_routes[c.route_id].name if c and c.route_id and c.route_id in all_routes else "—"
        clients_html += (
            f'<tr><td>{cname}</td><td class="muted">{rname}</td>'
            f'<td class="c">{cagg["cnt"]}</td>'
            f'<td class="r">{fmt(cagg["sum"])}</td></tr>'
        )

    unique_days = len({inv.invoice_date for inv in invoices_m})

    html = f"""<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="UTF-8">
  <title>Місячний звіт {month_label}</title>
  {_REPORT_CSS}
</head>
<body>
{PRINT_BTN}
<div class="rpt-wrap">
  <div class="rpt-header">
    <div>
      <div class="rpt-title">{bakery_name}</div>
      <div class="rpt-sub">Місячний звіт продажів</div>
    </div>
    <div class="rpt-date">{month_label}</div>
  </div>

  <div style="font-size:8.5pt;color:#555;margin-bottom:14px;">
    Накладних: <b>{grand_cnt}</b> &nbsp;·&nbsp;
    Днів з відвантаженням: <b>{unique_days}</b> &nbsp;·&nbsp;
    Загальна сума: <b>{fmt(grand_sum_r)} грн</b>
  </div>

  <div class="rpt-section">
    <div class="rpt-stitle">1. ПРОДУКЦІЯ</div>
    <table class="rpt">
      <thead>
        <tr>
          <th>Виріб</th>
          <th class="c" style="width:50px">Од.</th>
          <th class="r" style="width:90px">Кількість</th>
          <th class="r" style="width:120px">Сума, грн</th>
        </tr>
      </thead>
      <tbody>
        {products_html}
        <tr class="rtot">
          <td colspan="2"><strong>Разом</strong></td>
          <td class="r"><strong>{grand_qty:g}</strong></td>
          <td class="r"><strong>{fmt(grand_sum_p)}</strong></td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="rpt-section">
    <div class="rpt-stitle">2. МАРШРУТИ</div>
    <table class="rpt">
      <thead>
        <tr>
          <th>Маршрут</th>
          <th class="c" style="width:90px">Накладних</th>
          <th class="r" style="width:130px">Сума, грн</th>
        </tr>
      </thead>
      <tbody>
        {routes_html}
        <tr class="rtot">
          <td><strong>Разом</strong></td>
          <td class="c"><strong>{grand_cnt}</strong></td>
          <td class="r"><strong>{fmt(grand_sum_r)}</strong></td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="rpt-section">
    <div class="rpt-stitle">3. ТОП КЛІЄНТИ</div>
    <table class="rpt">
      <thead>
        <tr>
          <th>Клієнт</th>
          <th>Маршрут</th>
          <th class="c" style="width:80px">Накладних</th>
          <th class="r" style="width:130px">Сума, грн</th>
        </tr>
      </thead>
      <tbody>{clients_html}</tbody>
    </table>
  </div>
</div>
</body>
</html>"""
    return HTMLResponse(content=html)


# ─── Виписка по клієнту ───────────────────────────────────────────────────────

@router.get("/client-statement", response_class=HTMLResponse)
def client_statement(
    client_id: int,
    from_date: str,
    to_date: str,
    db: Session = Depends(get_db),
):
    """Виписка по клієнту: хронологія операцій з рухом балансу за період."""
    cfg = get_settings(db)
    bakery_name = cfg.get("bakery_name", "Пекарня")

    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Клієнта не знайдено")

    client_name = client.short_name or client.full_name
    art_map = {a.id: a for a in db.query(FinanceArticle).all()}

    # Відкриваючий залишок
    open_finances = (
        db.query(Finance)
        .filter(Finance.client_id == client_id, Finance.finance_date < from_date)
        .all()
    )
    opening_balance = sum(f.amount * f.sign for f in open_finances)

    # Операції за період
    period_finances = (
        db.query(Finance)
        .filter(
            Finance.client_id == client_id,
            Finance.finance_date >= from_date,
            Finance.finance_date <= to_date,
        )
        .order_by(Finance.finance_date, Finance.id)
        .all()
    )

    rows_html = ""
    running = opening_balance
    total_debit = total_credit = 0.0

    for f in period_finances:
        art    = art_map.get(f.article_id)
        aname  = art.name if art else (f.finance_type or "—")
        amount = f.amount * f.sign
        running += amount

        if amount < 0:
            dv, cv, acls = fmt(abs(amount)), "", "red"
            total_debit += abs(amount)
        else:
            dv, cv, acls = "", fmt(amount), "green"
            total_credit += amount

        bal_cls  = "red" if running < -0.005 else ("green" if running > 0.005 else "")
        bal_sign = "−" if running < -0.005 else ""
        notes_span = (
            f'<br><span class="muted" style="font-size:8pt;">{f.notes}</span>'
            if f.notes else ""
        )
        rows_html += (
            f'<tr><td class="c">{f.finance_date}</td>'
            f'<td>{aname}{notes_span}</td>'
            f'<td class="r red">{dv}</td>'
            f'<td class="r green">{cv}</td>'
            f'<td class="r {bal_cls}">{bal_sign}{fmt(abs(running))}</td></tr>'
        )

    closing_balance = running
    ob_cls  = "red" if opening_balance < -0.005 else ("green" if opening_balance > 0.005 else "")
    cb_cls  = "red" if closing_balance < -0.005 else ("green" if closing_balance > 0.005 else "")
    ob_sign = "−" if opening_balance < -0.005 else "+"
    cb_sign = "−" if closing_balance < -0.005 else "+"

    empty_msg = (
        "" if rows_html else
        '<tr><td colspan="5" class="muted" style="text-align:center;padding:10px;">'
        '— Операцій за цей період немає —</td></tr>'
    )

    html = f"""<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="UTF-8">
  <title>Виписка {client_name}</title>
  {_REPORT_CSS}
</head>
<body>
{PRINT_BTN}
<div class="rpt-wrap">
  <div class="rpt-header">
    <div>
      <div class="rpt-title">{bakery_name}</div>
      <div class="rpt-sub">Виписка по клієнту</div>
    </div>
    <div style="text-align:right;">
      <div class="rpt-date">{client_name}</div>
      <div style="font-size:9pt;color:#555;margin-top:2px;">
        {ua_date(from_date)} — {ua_date(to_date)}
      </div>
    </div>
  </div>

  <table class="rpt" style="margin-bottom:2px;">
    <tbody>
      <tr class="rsub">
        <td colspan="4">Залишок на початок періоду ({ua_date(from_date)})</td>
        <td class="r {ob_cls}">{ob_sign}&nbsp;{fmt(abs(opening_balance))}&nbsp;грн</td>
      </tr>
    </tbody>
  </table>

  <table class="rpt">
    <thead>
      <tr>
        <th class="c" style="width:85px">Дата</th>
        <th>Стаття</th>
        <th class="r" style="width:100px">Борг, грн</th>
        <th class="r" style="width:100px">Оплата, грн</th>
        <th class="r" style="width:110px">Залишок, грн</th>
      </tr>
    </thead>
    <tbody>
      {rows_html}{empty_msg}
      <tr class="rtot">
        <td colspan="2"><strong>Оборот за період</strong></td>
        <td class="r red"><strong>{fmt(total_debit)}</strong></td>
        <td class="r green"><strong>{fmt(total_credit)}</strong></td>
        <td></td>
      </tr>
    </tbody>
  </table>

  <table class="rpt" style="margin-top:4px;">
    <tbody>
      <tr class="rtot">
        <td colspan="4">
          <strong>Залишок на кінець періоду ({ua_date(to_date)})</strong>
        </td>
        <td class="r {cb_cls}">
          <strong>{cb_sign}&nbsp;{fmt(abs(closing_balance))}&nbsp;грн</strong>
        </td>
      </tr>
    </tbody>
  </table>
</div>
</body>
</html>"""
    return HTMLResponse(content=html)


# ── Сортування за групами клієнтів (для завантаження машини) ──────────────────

@router.get("/group-sort", response_class=HTMLResponse)
def print_group_sort(date: str, db: Session = Depends(get_db)):
    """Друкована форма А4: вироби, агреговані за маршрутом → групою клієнтів.

    Кожен маршрут починається з нової сторінки. У межах маршруту — секції
    по групах (sort_order, потім name); клієнти без групи — секція 'Без групи'.
    Всередині секції рядки — Тип (категорія) → Виріб → Сумарна кількість.
    """
    from backend.models.references import ClientGroup

    # Базовий SELECT всіх замовлень на дату з потрібними join-ами.
    rows = (
        db.query(
            Order.product_id,
            Order.qty,
            Client.id.label("client_id"),
            Client.route_id,
            Client.client_group_id,
        )
        .join(Client, Client.id == Order.client_id)
        .filter(
            Order.order_date == date,
            Order.parent_order_id.is_(None),
            Order.origin_id.is_(None),
            Order.qty > 0,
            ~((Order.source == "bot") & (Order.bot_status == "pending")),
            Client.client_kind == "customer",
        )
        .all()
    )
    if not rows:
        raise HTTPException(status_code=404, detail=f"Замовлень на {date} не знайдено")

    # Lookup-словники
    routes_by_id: dict[int, Route] = {
        r.id: r for r in db.query(Route).order_by(Route.sort_order, Route.name).all()
    }
    groups_by_id: dict[int, ClientGroup] = {
        g.id: g for g in db.query(ClientGroup).all()
    }
    products_by_id: dict[int, Product] = {p.id: p for p in db.query(Product).all()}
    categories_by_id: dict[int, Category] = {c.id: c for c in db.query(Category).all()}

    # Агрегація: (route_id, group_id_or_none, product_id) -> sum(qty)
    from collections import defaultdict
    agg: dict[tuple[Optional[int], Optional[int], int], float] = defaultdict(float)
    for r in rows:
        rid = r.route_id
        gid = r.client_group_id
        # Якщо група була видалена, але client_group_id ще не скинутий — трактуємо як без групи.
        if gid is not None and gid not in groups_by_id:
            gid = None
        # Якщо у клієнта призначена група іншого маршруту (legacy) — теж без групи у цьому маршруті.
        elif gid is not None and groups_by_id[gid].route_id != rid:
            gid = None
        agg[(rid, gid, r.product_id)] += float(r.qty or 0)

    # Структура для рендеру: route_id -> list of (group_label, sort_key, items)
    # items: list[(category_name, product_name, qty)] вже відсортовано
    route_pages: list[tuple[Route, list[dict]]] = []

    # Збираємо групи у порядку маршруту
    by_route: dict[Optional[int], list[tuple[Optional[int], int, str, dict[int, float]]]] = defaultdict(list)
    # У кожному маршруті: список (gid, sort_order, name, {product_id: qty})
    tmp: dict[tuple[Optional[int], Optional[int]], dict[int, float]] = defaultdict(dict)
    for (rid, gid, pid), qty in agg.items():
        tmp[(rid, gid)][pid] = qty

    for (rid, gid), pid_map in tmp.items():
        if gid is None:
            label = "Без групи"
            sort_key = (9_999, label)
        else:
            g = groups_by_id[gid]
            label = g.name
            sort_key = (g.sort_order or 0, label)
        by_route[rid].append((gid, sort_key, label, pid_map))

    # Сортуємо маршрути за sort_order/name, формуємо сторінки
    sorted_rids = sorted(
        by_route.keys(),
        key=lambda x: (
            (routes_by_id[x].sort_order if x in routes_by_id else 9999, routes_by_id[x].name) if x else (9999, "Без маршруту")
        ),
    )

    pages_html = ""
    for idx, rid in enumerate(sorted_rids):
        route = routes_by_id.get(rid)
        route_name = route.name if route else "Без маршруту"
        groups = sorted(by_route[rid], key=lambda g: g[1])

        groups_html = ""
        route_total = 0.0
        for _gid, _sk, label, pid_map in groups:
            # Сортуємо вироби: category.sort_order → category.name → product.name
            items = []
            for pid, qty in pid_map.items():
                p = products_by_id.get(pid)
                if not p:
                    continue
                cat = categories_by_id.get(p.category_id) if p.category_id else None
                items.append((
                    cat.sort_order if cat else 9999,
                    cat.name if cat else "—",
                    p.name,
                    qty,
                ))
            items.sort(key=lambda x: (x[0], x[1], x[2]))

            rows_html = ""
            group_total = 0.0
            for _co, cat_name, p_name, qty in items:
                rows_html += (
                    f"<tr><td class='cat'>{cat_name}</td>"
                    f"<td>{p_name}</td>"
                    f"<td class='r'>{qty:g}</td></tr>"
                )
                group_total += qty
            route_total += group_total

            groups_html += f"""
            <div class="group-title">Група: <strong>{label}</strong></div>
            <table class="sort-tbl">
              <thead>
                <tr>
                  <th style="width:24%">Тип</th>
                  <th>Назва</th>
                  <th class="r" style="width:24%">Сумарна кількість</th>
                </tr>
              </thead>
              <tbody>{rows_html}</tbody>
              <tfoot>
                <tr>
                  <td colspan="2" class="r"><strong>Разом по групі</strong></td>
                  <td class="r"><strong>{group_total:g}</strong></td>
                </tr>
              </tfoot>
            </table>"""

        page_break = "" if idx == 0 else 'style="page-break-before: always;"'
        pages_html += f"""
        <div class="sort-page" {page_break}>
          <div class="route-title">Маршрут: <strong>{route_name}</strong>
            <span class="route-meta">· {ua_date(date)}</span>
          </div>
          {groups_html}
          <div class="route-grand">Разом по маршруту: <strong>{route_total:g}</strong></div>
        </div>"""

    cfg = get_settings(db)
    bakery_name = cfg.get("bakery_name", "Пекарня")

    css = """<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, sans-serif; font-size: 10.5pt; color: #000; background: #fff; }
@page { size: A4; margin: 12mm 14mm; }

/* Кнопки «Друкувати» / «✕» — лише в preview, на друк не виходять */
@media print { .no-print { display: none !important; } }

.sort-page { padding: 0 0 6mm; }
.doc-title { font-size: 13pt; font-weight: bold; text-align: center; padding-bottom: 4mm; }
.doc-subtitle { text-align: center; font-size: 9pt; color: #555; margin-bottom: 4mm; }

.route-title { font-size: 13pt; font-weight: 500; padding: 2mm 0 3mm; border-bottom: 2px solid #1a3a5c; margin-bottom: 4mm; color: #1a3a5c; }
.route-meta { font-size: 9.5pt; color: #888; font-style: italic; }

.group-title { font-size: 11pt; margin: 4mm 0 1.5mm; color: #555; }
.group-title strong { color: #000; }

.sort-tbl { width: 100%; border-collapse: collapse; margin-bottom: 2mm; font-size: 10pt; }
.sort-tbl th { background: #e8eef5; border: 1px solid #888; padding: 1.5mm 2mm; font-weight: bold; text-align: left; font-size: 9.5pt; }
.sort-tbl td { border: 1px solid #bbb; padding: 1.2mm 2mm; }
.sort-tbl .cat { color: #555; }
.sort-tbl .r { text-align: right; }
.sort-tbl tfoot td { background: #f5f7fa; }

.route-grand { font-size: 11pt; text-align: right; padding: 2mm 4mm; margin-top: 3mm; border-top: 1px solid #1a3a5c; }
</style>"""

    html = f"""<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="UTF-8">
  <title>Сортування за групами — {date}</title>
  {css}
</head>
<body>
{PRINT_BTN}
<div class="doc-title">{bakery_name} — Сортування товару</div>
<div class="doc-subtitle">для завантаження машини на {ua_date(date)}</div>
{pages_html}
</body>
</html>"""
    return HTMLResponse(content=html)


# ── Маршрутні листи (для водіїв) ─────────────────────────────────────────────

@router.get("/route-sheet", response_class=HTMLResponse)
def print_route_sheet(date: str, db: Session = Depends(get_db)):
    """Друкована форма А4: маршрутний лист водія.

    Кожен маршрут починається з нової сторінки. У межах маршруту:
    - Шапка з підсумком по маршруту (всього шт і грн)
    - Розбивка по групах клієнтів (sort_order, потім name)
    - Усередині групи — рядки виробів, згруповані за категорією
      (Булка / Хліб) з підсумком категорії
    - Колонки: Назва | Кількість | Ціна | Брак | Ціна браку | Сума
      (Брак і Ціна браку — порожні для ручного заповнення водієм)
    """
    from backend.models.invoices import Invoice, InvoiceLine
    from backend.models.references import ClientGroup

    # Дані беремо з рядків накладних (status != cancelled) — те що водій
    # фактично везе. Включаємо draft/sent/processing/accepted.
    rows = (
        db.query(
            InvoiceLine.product_id,
            InvoiceLine.qty,
            InvoiceLine.price,
            InvoiceLine.price_override,
            InvoiceLine.sum,
            InvoiceLine.is_exchange,
            Client.id.label("client_id"),
            Client.route_id,
            Client.client_group_id,
        )
        .join(Invoice, Invoice.id == InvoiceLine.invoice_id)
        .join(Client, Client.id == Invoice.client_id)
        .filter(
            Invoice.invoice_date == date,
            Invoice.status != "cancelled",
            Client.client_kind == "customer",
        )
        .all()
    )
    if not rows:
        raise HTTPException(status_code=404, detail=f"Немає сформованих накладних на {date}")

    routes_by_id: dict[int, Route] = {
        r.id: r for r in db.query(Route).order_by(Route.sort_order, Route.name).all()
    }
    groups_by_id: dict[int, ClientGroup] = {g.id: g for g in db.query(ClientGroup).all()}
    products_by_id: dict[int, Product] = {p.id: p for p in db.query(Product).all()}
    categories_by_id: dict[int, Category] = {c.id: c for c in db.query(Category).all()}

    from collections import defaultdict
    # agg[(route_id, group_id_or_none, product_id)] = {qty, sum}
    agg: dict[tuple[Optional[int], Optional[int], int], dict[str, float]] = defaultdict(
        lambda: {"qty": 0.0, "sum": 0.0}
    )
    for r in rows:
        # Пропускаємо рядки обміну — на маршрутному листі не показуємо
        if r.is_exchange:
            continue
        rid = r.route_id
        gid = r.client_group_id
        if gid is not None and gid not in groups_by_id:
            gid = None
        elif gid is not None and groups_by_id[gid].route_id != rid:
            gid = None
        key = (rid, gid, r.product_id)
        agg[key]["qty"] += float(r.qty or 0)
        agg[key]["sum"] += float(r.sum or 0)

    if not agg:
        raise HTTPException(status_code=404, detail=f"Немає виробів для друку на {date}")

    # Структуруємо: by_route[rid] = list of (gid, sort_key, label, dict[pid]={qty, sum})
    by_route: dict[Optional[int], list[tuple[Optional[int], tuple, str, dict[int, dict]]]] = defaultdict(list)
    tmp: dict[tuple[Optional[int], Optional[int]], dict[int, dict]] = defaultdict(dict)
    for (rid, gid, pid), totals in agg.items():
        tmp[(rid, gid)][pid] = totals
    for (rid, gid), pid_map in tmp.items():
        if gid is None:
            label, sort_key = "Без групи", (9_999, "Без групи")
        else:
            g = groups_by_id[gid]
            label, sort_key = g.name, (g.sort_order or 0, g.name)
        by_route[rid].append((gid, sort_key, label, pid_map))

    sorted_rids = sorted(
        by_route.keys(),
        key=lambda x: (
            (routes_by_id[x].sort_order if x in routes_by_id else 9999, routes_by_id[x].name) if x else (9999, "Без маршруту")
        ),
    )

    cfg = get_settings(db)
    bakery_name = cfg.get("bakery_name", "Пекарня")

    pages_html = ""
    for idx, rid in enumerate(sorted_rids):
        route = routes_by_id.get(rid)
        route_name = route.name if route else "Без маршруту"
        groups = sorted(by_route[rid], key=lambda g: g[1])

        # Підсумки по маршруту
        route_qty = sum(t["qty"] for _g, _sk, _lb, pm in groups for t in pm.values())
        route_sum = sum(t["sum"] for _g, _sk, _lb, pm in groups for t in pm.values())

        groups_html = ""
        for _gid, _sk, label, pid_map in groups:
            # Розкладаємо по категоріях виробу
            cat_buckets: dict[Optional[int], list[tuple[Product, dict]]] = defaultdict(list)
            for pid, totals in pid_map.items():
                p = products_by_id.get(pid)
                if not p:
                    continue
                cat_buckets[p.category_id].append((p, totals))

            # Сортуємо категорії за sort_order
            sorted_cats = sorted(
                cat_buckets.keys(),
                key=lambda cid: (
                    categories_by_id[cid].sort_order if cid in categories_by_id else 9999,
                    categories_by_id[cid].name if cid in categories_by_id else "—",
                ),
            )

            cat_rows_html = ""
            for cid in sorted_cats:
                items = sorted(cat_buckets[cid], key=lambda x: x[0].name)
                cat_name = categories_by_id[cid].name if cid in categories_by_id else "—"
                cat_qty = sum(t["qty"] for _p, t in items)
                cat_sum = sum(t["sum"] for _p, t in items)
                cat_rows_html += f"""
                <tr class="cat-row">
                  <td class="cat-name">{cat_name}</td>
                  <td class="r"><strong>{cat_qty:g}</strong></td>
                  <td></td><td></td><td></td>
                  <td class="r"><strong>{fmt(cat_sum)}</strong></td>
                </tr>"""
                for p, t in items:
                    eff_price = (t["sum"] / t["qty"]) if t["qty"] else 0.0
                    cat_rows_html += f"""
                <tr>
                  <td class="prod-name">{p.name}</td>
                  <td class="r">{t['qty']:g}</td>
                  <td class="r">{fmt(eff_price)}</td>
                  <td></td>
                  <td></td>
                  <td class="r">{fmt(t['sum'])}</td>
                </tr>"""

            # Підсумки по групі
            grp_qty = sum(t["qty"] for pm in [pid_map] for t in pm.values())
            grp_sum = sum(t["sum"] for pm in [pid_map] for t in pm.values())

            groups_html += f"""
            <div class="group-block">
              <div class="group-title">
                <span class="group-label">Група</span>
                <span class="group-name">{label}</span>
                <span class="group-route">· маршрут {route_name}</span>
                <span class="group-stats">
                  <span class="stat-qty">{grp_qty:g} шт</span>
                  <span class="stat-sum">{fmt(grp_sum)} грн</span>
                </span>
              </div>
              <table class="route-tbl">
                <colgroup>
                  <col><col style="width:13%"><col style="width:11%">
                  <col style="width:10%"><col style="width:11%"><col style="width:14%">
                </colgroup>
                <thead>
                  <tr>
                    <th>Виріб</th>
                    <th class="r">К-сть</th>
                    <th class="r">Ціна</th>
                    <th class="c">Брак</th>
                    <th class="c">Ціна браку</th>
                    <th class="r">Сума</th>
                  </tr>
                </thead>
                <tbody>{cat_rows_html}</tbody>
              </table>
            </div>"""

        page_break = "" if idx == 0 else 'style="page-break-before: always;"'
        pages_html += f"""
        <div class="route-page" {page_break}>
          <header class="page-head">
            <h1 class="doc-title">Маршрутний лист — {route_name}</h1>
            <div class="meta-line">
              <span>{ua_date(date)}</span>
              <span class="meta-sep">·</span>
              <span>Всього: <strong>{route_qty:g}</strong> шт</span>
              <span class="meta-sep">·</span>
              <span>Сума: <strong>{fmt(route_sum)}</strong> грн</span>
            </div>
          </header>
          {groups_html}
          <footer class="page-foot">
            <div class="sig-row">
              <div class="sig-block">
                <div class="sig-line"></div>
                <div class="sig-cap">Видав (підпис)</div>
              </div>
              <div class="sig-block">
                <div class="sig-line"></div>
                <div class="sig-cap">Прийняв водій (підпис)</div>
              </div>
            </div>
          </footer>
        </div>"""

    css = """<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Segoe UI', 'Arial', sans-serif;
  font-size: 10pt; color: #1f2937; background: #fff;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
@page { size: A4; margin: 8mm 10mm; }
@media print { .no-print { display: none !important; } }

.route-page { padding: 0 0 3mm; }

/* ── Шапка сторінки (компактна, в один рядок) ──────────────────────────── */
.page-head {
  display: flex; justify-content: space-between; align-items: baseline;
  padding-bottom: 1.5mm; margin-bottom: 3mm;
  border-bottom: 2px solid #1a3a5c;
}
.doc-title {
  font-size: 14pt; font-weight: 700; color: #1a3a5c; line-height: 1.1;
}
.meta-line {
  font-size: 9.5pt; color: #555;
  display: flex; align-items: baseline; gap: 2mm;
}
.meta-line strong { color: #1a3a5c; font-weight: 700; }
.meta-line .meta-sep { color: #bbb; }

/* ── Група ──────────────────────────────────────────────────────────────── */
.group-block { margin-top: 3mm; page-break-inside: avoid; }
.group-title {
  display: flex; align-items: baseline; gap: 2.5mm;
  padding: 1mm 2.5mm; background: #1a3a5c; color: #fff;
  border-radius: 1mm 1mm 0 0;
}
.group-label {
  font-size: 8pt; text-transform: uppercase; letter-spacing: 0.08em;
  color: #c5d4e3;
}
.group-name { font-size: 11pt; font-weight: 700; }
.group-route {
  font-size: 9.5pt; font-weight: 500; color: #c5d4e3;
  flex: 1;
}
.group-stats { display: flex; gap: 3mm; font-size: 9.5pt; color: #c5d4e3; }
.group-stats .stat-qty,
.group-stats .stat-sum { color: #fff; font-weight: 600; }

/* ── Таблиця ────────────────────────────────────────────────────────────── */
.route-tbl {
  width: 100%; border-collapse: collapse; font-size: 10pt;
  border: 1px solid #cfd6df; border-top: none;
}
.route-tbl th {
  background: #e8eef5; padding: 1mm 2mm;
  font-weight: 600; text-align: left; font-size: 9pt;
  color: #1a3a5c; border-bottom: 1px solid #1a3a5c;
}
.route-tbl th.r { text-align: right; }
.route-tbl th.c { text-align: center; }

.route-tbl td {
  padding: 0.8mm 2mm; border-bottom: 1px solid #e5e9ee;
}
.route-tbl tr:last-child td { border-bottom: none; }
.route-tbl .r { text-align: right; font-variant-numeric: tabular-nums; }
.route-tbl .c { text-align: center; }
.route-tbl .prod-name { padding-left: 3.5mm; color: #1f2937; }

/* Рядок-категорія (Булка / Хліб) — акцентний підзаголовок */
.route-tbl tr.cat-row td {
  background: #f5f7fa;
  border-top: 1px solid #cfd6df;
  border-bottom: 1px solid #cfd6df;
  padding-top: 1.2mm; padding-bottom: 1.2mm;
}
.route-tbl tr.cat-row .cat-name {
  font-weight: 700; color: #1a3a5c; font-size: 10pt;
}

/* ── Підпис ─────────────────────────────────────────────────────────────── */
.page-foot { margin-top: 5mm; page-break-inside: avoid; }
.sig-row { display: flex; gap: 10mm; }
.sig-block { flex: 1; }
.sig-line {
  border-bottom: 1px solid #1f2937;
  height: 6mm; margin-bottom: 0.5mm;
}
.sig-cap {
  font-size: 8.5pt; color: #6b7280; text-align: center;
}
</style>"""

    html = f"""<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="UTF-8">
  <title>Маршрутний лист — {date}</title>
  {css}
</head>
<body>
{PRINT_BTN}
{pages_html}
</body>
</html>"""
    return HTMLResponse(content=html)


# ── Адресний лист (адреси і телефони клієнтів з сумами) ──────────────────────

@router.get("/address-sheet", response_class=HTMLResponse)
def print_address_sheet(date: str, db: Session = Depends(get_db)):
    """Друкована форма А4: адресний лист водія.

    Кожен маршрут на окремій сторінці. Усередині — групи клієнтів
    (sort_order, потім name; "Без групи" в кінці). У кожній групі —
    список клієнтів: Клієнт | Адреса | Телефон | Сума замовлення.
    Сума береться з накладної (Invoice.total_sum). Включаються накладні
    зі статусом != cancelled.
    """
    from backend.models.invoices import Invoice
    from backend.models.references import ClientGroup

    invoices = (
        db.query(Invoice)
        .join(Client, Client.id == Invoice.client_id)
        .filter(
            Invoice.invoice_date == date,
            Invoice.status != "cancelled",
            Invoice.corrective_for_id.is_(None),  # тільки базові, без корекцій
            Client.client_kind == "customer",
        )
        .all()
    )
    if not invoices:
        raise HTTPException(status_code=404, detail=f"Немає сформованих накладних на {date}")

    routes_by_id: dict[int, Route] = {
        r.id: r for r in db.query(Route).order_by(Route.sort_order, Route.name).all()
    }
    groups_by_id: dict[int, ClientGroup] = {g.id: g for g in db.query(ClientGroup).all()}
    clients_by_id: dict[int, Client] = {c.id: c for c in db.query(Client).all()}

    from collections import defaultdict
    # by_route[rid][(gid, sort_key, label)] = list of (client, total_sum)
    by_route: dict[Optional[int], dict[tuple, list]] = defaultdict(lambda: defaultdict(list))

    for inv in invoices:
        client = clients_by_id.get(inv.client_id)
        if not client:
            continue
        rid = client.route_id
        gid = client.client_group_id
        if gid is not None and gid not in groups_by_id:
            gid = None
        elif gid is not None and groups_by_id[gid].route_id != rid:
            gid = None
        if gid is None:
            grp_key = (None, (9_999, "Без групи"), "Без групи")
        else:
            g = groups_by_id[gid]
            grp_key = (gid, (g.sort_order or 0, g.name), g.name)
        by_route[rid][grp_key].append((client, float(inv.total_sum or 0)))

    sorted_rids = sorted(
        by_route.keys(),
        key=lambda x: (
            (routes_by_id[x].sort_order if x in routes_by_id else 9999, routes_by_id[x].name) if x else (9999, "Без маршруту")
        ),
    )

    cfg = get_settings(db)
    bakery_name = cfg.get("bakery_name", "Пекарня")

    pages_html = ""
    for idx, rid in enumerate(sorted_rids):
        route = routes_by_id.get(rid)
        route_name = route.name if route else "Без маршруту"
        groups = sorted(by_route[rid].items(), key=lambda kv: kv[0][1])
        route_total = sum(s for _grp_key, lst in groups for _c, s in lst)

        groups_html = ""
        for grp_key, lst in groups:
            label = grp_key[2]
            # Сортуємо клієнтів за коротким іменем
            lst_sorted = sorted(lst, key=lambda x: (x[0].short_name or x[0].full_name).lower())
            grp_total = sum(s for _c, s in lst_sorted)

            rows_html = ""
            for c, s in lst_sorted:
                name = c.short_name or c.full_name
                addr = c.address or "—"
                phone = c.phone or "—"
                rows_html += f"""
                <tr>
                  <td class="cl-name">{name}</td>
                  <td class="cl-addr">{addr}</td>
                  <td class="cl-phone">{phone}</td>
                  <td class="r">{fmt(s)} ₴</td>
                </tr>"""

            groups_html += f"""
            <div class="group-block">
              <div class="group-title">
                <span class="group-label">Група</span>
                <span class="group-name">{label}</span>
                <span class="group-route">· маршрут {route_name}</span>
                <span class="group-stats">
                  <span class="stat-cnt">{len(lst_sorted)} кл.</span>
                  <span class="stat-sum">{fmt(grp_total)} ₴</span>
                </span>
              </div>
              <table class="addr-tbl">
                <colgroup>
                  <col><col><col style="width:24%"><col style="width:18%">
                </colgroup>
                <thead>
                  <tr>
                    <th>Клієнт</th>
                    <th>Адреса</th>
                    <th>Телефон</th>
                    <th class="r">Сума зам.</th>
                  </tr>
                </thead>
                <tbody>{rows_html}</tbody>
              </table>
            </div>"""

        page_break = "" if idx == 0 else 'style="page-break-before: always;"'
        pages_html += f"""
        <div class="route-page" {page_break}>
          <header class="page-head">
            <h1 class="doc-title">Адресний лист — {route_name}</h1>
            <div class="meta-line">
              <span>{ua_date(date)}</span>
              <span class="meta-sep">·</span>
              <span>Клієнтів: <strong>{sum(len(lst) for _gk, lst in groups)}</strong></span>
              <span class="meta-sep">·</span>
              <span>Сума: <strong>{fmt(route_total)}</strong> ₴</span>
            </div>
          </header>
          {groups_html}
        </div>"""

    css = """<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Segoe UI', 'Arial', sans-serif;
  font-size: 10pt; color: #1f2937; background: #fff;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
@page { size: A4; margin: 8mm 10mm; }
@media print { .no-print { display: none !important; } }

.route-page { padding: 0 0 3mm; }

.page-head {
  display: flex; justify-content: space-between; align-items: baseline;
  padding-bottom: 1.5mm; margin-bottom: 3mm;
  border-bottom: 2px solid #1a3a5c;
}
.doc-title { font-size: 14pt; font-weight: 700; color: #1a3a5c; line-height: 1.1; }
.meta-line { font-size: 9.5pt; color: #555; display: flex; gap: 2mm; align-items: baseline; }
.meta-line strong { color: #1a3a5c; font-weight: 700; }
.meta-line .meta-sep { color: #bbb; }

.group-block { margin-top: 3mm; page-break-inside: avoid; }
.group-title {
  display: flex; align-items: baseline; gap: 2.5mm;
  padding: 1mm 2.5mm; background: #1a3a5c; color: #fff;
  border-radius: 1mm 1mm 0 0;
}
.group-label {
  font-size: 8pt; text-transform: uppercase; letter-spacing: 0.08em;
  color: #c5d4e3;
}
.group-name { font-size: 11pt; font-weight: 700; }
.group-route { font-size: 9.5pt; font-weight: 500; color: #c5d4e3; flex: 1; }
.group-stats { display: flex; gap: 3mm; font-size: 9.5pt; color: #c5d4e3; }
.group-stats .stat-cnt,
.group-stats .stat-sum { color: #fff; font-weight: 600; }

.addr-tbl {
  width: 100%; border-collapse: collapse; font-size: 10pt;
  border: 1px solid #cfd6df; border-top: none;
}
.addr-tbl th {
  background: #e8eef5; padding: 1mm 2mm;
  font-weight: 600; text-align: left; font-size: 9pt;
  color: #1a3a5c; border-bottom: 1px solid #1a3a5c;
}
.addr-tbl th.r { text-align: right; }
.addr-tbl td {
  padding: 0.8mm 2mm; border-bottom: 1px solid #e5e9ee;
}
.addr-tbl tr:last-child td { border-bottom: none; }
.addr-tbl .r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.addr-tbl .cl-name { font-weight: 500; color: #111; }
.addr-tbl .cl-phone { color: #1f2937; white-space: nowrap; font-variant-numeric: tabular-nums; }
.addr-tbl .cl-addr { color: #4b5563; }
</style>"""

    html = f"""<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="UTF-8">
  <title>Адресний лист — {date}</title>
  {css}
</head>
<body>
{PRINT_BTN}
{pages_html}
</body>
</html>"""
    return HTMLResponse(content=html)
