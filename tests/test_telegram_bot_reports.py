"""Регрес-тести для Telegram-звітів персоналу (backend/services/telegram_bot.py).

1) top_debtors (backend/routers/dashboard.py) і _report_debts() раніше рахували
   боржників по ВСІХ client_kind — включно з системними клієнтами (Списання/
   Пайок/Недопечено), які є внутрішніми бухгалтерськими рахунками, а не
   реальними боржниками. Виправлено: фільтр client_kind == 'customer', як і
   в get_summary()/FinancesPage.tsx (regularBalances).

2) _report_finance() (команда /report) переписана на основі get_dashboard() —
   та сама інформація і термінологія, що й на дашборді власника: "Залишок у
   касі" (раніше був відсутній), "Борг клієнтів"/"Переплата клієнтів" (раніше
   "Загальний борг"/"Аванси" — незрозумілі назви) і сьогоднішня виручка/
   надходження/каса. "Нетто-баланс" (аванси мінус борг) і "Топ боржники"
   (дублює окрему команду /debts) прибрано.
"""

from backend.database import SessionLocal
from backend.models.references import Client
from backend.models.finances import Finance
from backend.services.finance import get_cash_balance
from backend.services.telegram_bot import _report_finance, _report_debts


def _mk_customer(db, name, balance, date):
    c = Client(full_name=name, client_kind="customer", is_active=1)
    db.add(c); db.flush()
    db.add(Finance(finance_date=date, client_id=c.id, finance_type="invoice",
                    amount=abs(balance), sign=-1 if balance < 0 else 1,
                    notes="Тест", created_by=None))
    return c


def test_report_finance_matches_dashboard_cash_balance(app_client, admin_token):
    db = SessionLocal()
    expected_cash = get_cash_balance(db)
    db.close()

    text = _report_finance()
    # Нова структура: каса + борг/переплата клієнтів + сьогоднішня активність,
    # без застарілого "Нетто-баланс" і без дубльованого "Топ боржники".
    assert "Залишок у касі" in text
    assert "Борг клієнтів" in text
    assert "Переплата клієнтів" in text
    assert "Виставлено" in text
    assert "Надійшло" in text
    assert "Виведено з каси" in text
    assert "Нетто-баланс" not in text
    assert "Топ боржники" not in text

    sign = "+" if expected_cash >= 0 else ""
    expected_str = f"{sign}{expected_cash:,.2f}".replace(",", " ")
    assert expected_str in text, f"очікували залишок у касі {expected_str} у тексті звіту"


def test_report_debts_excludes_writeoff_system_client(app_client, admin_token):
    db = SessionLocal()
    date = "2027-07-02"

    writeoff = db.query(Client).filter_by(client_kind="writeoff").first()
    assert writeoff is not None, "системний клієнт 'Списання' має існувати після старту застосунку"
    db.add(Finance(finance_date=date, client_id=writeoff.id, finance_type="writeoff",
                    amount=60000.0, sign=-1, notes="Тест-списання-2", created_by=None))

    _mk_customer(db, "Тест-боржник-2", -77.0, date)
    db.commit()
    db.close()

    text = _report_debts()
    assert "Списання" not in text
    assert "Тест-боржник-2" in text


def test_dashboard_top_debtors_excludes_writeoff_system_client(app_client, admin_token):
    from backend.routers.dashboard import get_dashboard

    db = SessionLocal()
    date = "2027-07-03"

    writeoff = db.query(Client).filter_by(client_kind="writeoff").first()
    writeoff_name = writeoff.full_name
    db.add(Finance(finance_date=date, client_id=writeoff.id, finance_type="writeoff",
                    amount=70000.0, sign=-1, notes="Тест-списання-3", created_by=None))

    _mk_customer(db, "Тест-боржник-3", -55.0, date)
    db.commit()
    db.close()

    db = SessionLocal()
    result = get_dashboard(date_param=None, db=db)
    db.close()

    names = [d["client_name"] for d in result["top_debtors"]]
    assert writeoff_name not in names
    assert "cash_balance" in result["finance"]
