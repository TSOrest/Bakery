"""Тести групування рядків ЛИШЕ на друкованій формі накладної.

Дані в БД (invoice_lines) лишаються окремими рядками, як їх створив
генератор накладних (кожен запис orders — власне замовлення, переміщення
від іншого клієнта, надлишок тощо — стає окремим InvoiceLine). Об'єднання
однакового виробу за однаковою ціною застосовується ЛИШЕ у
`_merge_lines_for_display()` під час рендерингу друкованої форми
(`render_invoice_block` — HTML для браузера, `render_invoice_pdf_bytes` —
PDF для Telegram), щоб клієнт не бачив той самий виріб кілька разів
на паперовій накладній. Жоден запис у БД при цьому не змінюється.
"""

from backend.models.references import Client, Product
from backend.models.invoices import Invoice, InvoiceLine
from backend.routers.print_views import render_invoice_block, _merge_lines_for_display


def _mk_client(db, name="Клієнт"):
    c = Client(full_name=name, client_kind="customer", is_active=1)
    db.add(c); db.flush()
    return c


def _mk_product(db, name="Ватрушка"):
    p = Product(name=name, is_active=1)
    db.add(p); db.flush()
    return p


def _mk_invoice(db, client_id, date="2026-09-20"):
    inv = Invoice(invoice_number=f"TEST-{client_id}-{date}", invoice_date=date,
                  client_id=client_id, status="draft", total_sum=0)
    db.add(inv); db.flush()
    return inv


def test_merge_lines_for_display_sums_same_price():
    """Три окремих рядки того самого виробу за тією ж ціною → один на друку."""
    lines = [
        InvoiceLine(product_id=1, qty=2, price=18.5, sum=37.0),
        InvoiceLine(product_id=1, qty=8, price=18.5, sum=148.0),
        InvoiceLine(product_id=1, qty=1, price=18.5, sum=18.5),
    ]
    merged = _merge_lines_for_display(lines)
    assert len(merged) == 1
    assert merged[0].qty == 11
    assert merged[0].sum == 203.5


def test_merge_lines_for_display_keeps_different_price_separate():
    """Рядок з іншою ефективною ціною (price_override) не зливається."""
    lines = [
        InvoiceLine(product_id=1, qty=3, price=12.0, sum=36.0),
        InvoiceLine(product_id=1, qty=2, price=12.0, price_override=9.0, sum=18.0),
    ]
    merged = _merge_lines_for_display(lines)
    assert len(merged) == 2
    assert sorted(m.qty for m in merged) == [2, 3]


def test_render_invoice_block_merges_display_but_keeps_db_rows(db_session):
    """Рендер друкованої форми показує один рядок; у БД лишається два записи."""
    db = db_session
    c = _mk_client(db)
    p = _mk_product(db)
    inv = _mk_invoice(db, c.id)
    db.add(InvoiceLine(invoice_id=inv.id, product_id=p.id, qty=2, price=18.5, sum=37.0))
    db.add(InvoiceLine(invoice_id=inv.id, product_id=p.id, qty=8, price=18.5, sum=148.0))
    db.flush()
    db.refresh(inv)

    assert len(inv.lines) == 2  # БД не чіпаємо

    html = render_invoice_block(inv, {}, db)
    assert html.count(">Ватрушка<") == 1  # на друку — один рядок
    assert ">10<" in html               # підсумована кількість (2+8)
    assert len(inv.lines) == 2          # рендер нічого не змінив у БД
