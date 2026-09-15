"""PDF-версія Денного звіту пекарні (backend/routers/print_views.py,
render_daily_report_pdf_bytes) — команда /dailyreport у Telegram-боті.

Рендерить ЛІТЕРАЛЬНО ту саму HTML-відповідь, що й /print/daily-report
(daily_report() напряму), через headless Edge/Chrome (--print-to-pdf) —
report-parity гарантована самим використанням тієї самої функції, а не
дублюванням HTML/даних. Пропускається якщо на машині немає Edge/Chrome
(headless-браузер потрібен лише для цього; xhtml2pdf свідомо не
використовується — падає на @page-синтаксисі та кирилиці в @font-face).
"""

import pytest

from backend.database import SessionLocal
from backend.routers.print_views import _find_chromium, render_daily_report_pdf_bytes


@pytest.mark.skipif(not _find_chromium(), reason="Edge/Chrome не встановлено на цій машині")
def test_daily_report_pdf_generates_valid_pdf(app_client, admin_token):
    db = SessionLocal()
    pdf = render_daily_report_pdf_bytes("2027-08-01", db)
    db.close()

    assert pdf.startswith(b"%PDF"), "результат має бути дійсним PDF-файлом"
    assert len(pdf) > 1000
