"""Тести опціонального налаштування 'Обмін колонкою в накладній'
(invoice_exchange_inline, вимкнено за замовчуванням).

Коли увімкнено — кількість обміну показується новою колонкою «Обмін» одразу
за «Кільк.» в основному списку виробів, замість окремої секції «ОБМІН» унизу.
Правила (за замовленням користувача):
  1. Виріб зі звичайним рядком + обміном — обмін у тому самому рядку.
  2. Виріб ЛИШЕ з обміном — синтетичний рядок з qty=price=sum=0, обмін заповнено.
  3. Виріб із 2 рядками різної ціни — обмін лише в першому з них.
Дані в БД (invoice_lines) не змінюються — це суто рендер-логіка, як і
групування однакового виробу за ціною (`_merge_lines_for_display`).
"""

from backend.models.references import Client, Product
from backend.models.invoices import Invoice, InvoiceLine
from backend.routers.print_views import (
    render_invoice_block, _apply_inline_exchange, _obmin_getter,
)


def _mk_client(db, name="Клієнт"):
    c = Client(full_name=name, client_kind="customer", is_active=1)
    db.add(c); db.flush()
    return c


def _mk_product(db, name="Виріб"):
    p = Product(name=name, is_active=1)
    db.add(p); db.flush()
    return p


def _mk_invoice(db, client_id, date="2026-09-20"):
    inv = Invoice(invoice_number=f"TEST-{client_id}-{date}", invoice_date=date,
                  client_id=client_id, status="draft", total_sum=0)
    db.add(inv); db.flush()
    return inv


# ── _apply_inline_exchange / _obmin_getter: чисті функції, без БД ──────────

def test_apply_inline_exchange_adds_synthetic_row_for_exchange_only_product():
    """Виріб є лише в обміні (нема звичайного рядка) → додається рядок qty=0."""
    main_lines = [InvoiceLine(product_id=1, qty=5, price=10.0, sum=50.0)]
    exch_lines = [InvoiceLine(product_id=2, qty=3, price=0.0, sum=0.0, line_kind="exchange")]

    exch_by_product = _apply_inline_exchange(main_lines, exch_lines)

    assert exch_by_product == {2: 3.0}
    assert len(main_lines) == 2
    synthetic = next(l for l in main_lines if l.product_id == 2)
    assert synthetic.qty == 0.0
    assert synthetic.price == 0.0
    assert synthetic.sum == 0.0


def test_apply_inline_exchange_no_synthetic_row_when_product_already_has_line():
    """Виріб уже є в main_lines — синтетичний рядок НЕ додається (без дублю)."""
    main_lines = [InvoiceLine(product_id=1, qty=5, price=10.0, sum=50.0)]
    exch_lines = [InvoiceLine(product_id=1, qty=2, price=0.0, sum=0.0, line_kind="exchange")]

    exch_by_product = _apply_inline_exchange(main_lines, exch_lines)

    assert exch_by_product == {1: 2.0}
    assert len(main_lines) == 1


def test_obmin_getter_returns_qty_only_on_first_call_per_product():
    """Другий виклик для того самого product_id (другий ціновий рядок виробу) — 0."""
    get = _obmin_getter({5: 4.0})
    assert get(5) == 4.0
    assert get(5) == 0.0
    assert get(6) == 0.0  # для цього продукту обміну не було взагалі


# ── render_invoice_block: інтеграційні перевірки з реальною БД ─────────────

def test_render_invoice_block_default_off_keeps_current_layout(db_session):
    """Перемикач вимкнено (типово) — вигляд лишається сьогоднішнім: окрема
    секція ОБМІН, без нової колонки."""
    db = db_session
    c = _mk_client(db)
    p = _mk_product(db, "Хліб Бородинський")
    inv = _mk_invoice(db, c.id)
    db.add(InvoiceLine(invoice_id=inv.id, product_id=p.id, qty=10, price=20.0, sum=200.0))
    db.add(InvoiceLine(invoice_id=inv.id, product_id=p.id, qty=3, price=0.0, sum=0.0, line_kind="exchange"))
    db.flush(); db.refresh(inv)

    html = render_invoice_block(inv, {}, db)
    # "exch-section" — однозначний маркер окремої секції (текст заголовка
    # секції сам по собі теж "Обмін", лише CSS text-transform робить його
    # ВЕЛИКИМИ на екрані — тому орієнтуємось на CSS-клас, а не на текст).
    assert "exch-section" in html
    assert '>Обм.</th>' not in html   # нової колонки нема


def test_render_invoice_block_inline_same_product(db_session):
    """Увімкнено: звичайний + обмінний рядок того самого виробу зливаються
    в один рядок з новою колонкою; окремої секції ОБМІН більше немає."""
    db = db_session
    c = _mk_client(db)
    p = _mk_product(db, "Хліб Бородинський")
    inv = _mk_invoice(db, c.id)
    db.add(InvoiceLine(invoice_id=inv.id, product_id=p.id, qty=10, price=20.0, sum=200.0))
    db.add(InvoiceLine(invoice_id=inv.id, product_id=p.id, qty=3, price=0.0, sum=0.0, line_kind="exchange"))
    db.flush(); db.refresh(inv)

    html = render_invoice_block(inv, {"invoice_exchange_inline": "1"}, db)
    assert "exch-section" not in html
    assert '>Обм.</th>' in html
    assert html.count(">Хліб Бородинський<") == 1
    assert '<td class="c">10</td>' in html   # Кільк.
    assert '<td class="c">3</td>' in html    # Обмін


def test_render_invoice_block_inline_exchange_only_product(db_session):
    """Увімкнено: виріб ЛИШЕ в обміні (без звичайного замовлення) — з'являється
    рядком з qty=0/ціна=0/сума=0 і заповненою колонкою Обмін."""
    db = db_session
    c = _mk_client(db)
    p = _mk_product(db, "Рогалик")
    inv = _mk_invoice(db, c.id)
    db.add(InvoiceLine(invoice_id=inv.id, product_id=p.id, qty=5, price=0.0, sum=0.0, line_kind="exchange"))
    db.flush(); db.refresh(inv)

    html = render_invoice_block(inv, {"invoice_exchange_inline": "1"}, db)
    assert ">Рогалик<" in html
    assert '<td class="c">5</td>' in html    # обмін
    assert '<td class="c">0</td>' in html    # кільк. = 0
    assert '<td class="r">0,00</td>' in html  # ціна = 0,00 (і сума теж 0,00)


def test_render_invoice_block_inline_exchange_only_first_price_row(db_session):
    """Увімкнено: виріб має 2 рядки різної ціни — обмін дописується лише в
    перший з них, другий лишається без обміну."""
    db = db_session
    c = _mk_client(db)
    p = _mk_product(db, "Батон")
    inv = _mk_invoice(db, c.id)
    db.add(InvoiceLine(invoice_id=inv.id, product_id=p.id, qty=4, price=15.0, sum=60.0))
    db.add(InvoiceLine(invoice_id=inv.id, product_id=p.id, qty=2, price=15.0, price_override=12.0, sum=24.0))
    db.add(InvoiceLine(invoice_id=inv.id, product_id=p.id, qty=6, price=0.0, sum=0.0, line_kind="exchange"))
    db.flush(); db.refresh(inv)

    html = render_invoice_block(inv, {"invoice_exchange_inline": "1"}, db)
    assert html.count(">Батон<") == 2                  # два цінові рядки, як і без обміну
    # Обмін = 6 показано РІВНО один раз (у клітинці "Обмін", не в підсумку
    # "Усього ... штук", який збігом теж дорівнює 4+2=6 — тому звіряємось
    # саме на markup клітинки колонки Обмін, а не на голий текст "6").
    assert html.count('<td class="c">6</td>') == 1


def test_render_invoice_block_inline_no_effect_without_exchange(db_session):
    """Увімкнено, але в накладній немає жодного обміну — вигляд не змінюється
    (нема нової колонки, нема порожньої секції)."""
    db = db_session
    c = _mk_client(db)
    p = _mk_product(db, "Батон")
    inv = _mk_invoice(db, c.id)
    db.add(InvoiceLine(invoice_id=inv.id, product_id=p.id, qty=4, price=15.0, sum=60.0))
    db.flush(); db.refresh(inv)

    html_on  = render_invoice_block(inv, {"invoice_exchange_inline": "1"}, db)
    html_off = render_invoice_block(inv, {}, db)
    assert ">Обм.</th>" not in html_on
    assert "exch-section" not in html_on
    assert html_on == html_off
