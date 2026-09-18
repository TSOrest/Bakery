"""Регрес-тест на критичну знахідку QA-аудиту: GET /dashboard/?date_param=
ігнорував обрану дату для всіх фінансових цифр (борг/каса/переплата/
топ-боржники завжди рахувались "на зараз", а не на обрану дату) —
підтверджено на реальних даних клієнта (три різні дати з понад місяцем
активної роботи між ними давали побайтово ідентичний фінансовий блок).

Виправлено: get_dashboard() передає as_of=today у get_summary()/
get_all_balances() замість викликати їх без обмеження по даті.
"""

from backend.database import SessionLocal
from backend.models.references import Client
from backend.models.finances import Finance, FinanceArticle


def test_dashboard_finance_differs_between_dates_around_a_new_invoice(app_client, admin_token):
    db = SessionLocal()
    client = Client(full_name="Тест-дашборд-дата", client_kind="customer", is_active=1)
    db.add(client); db.flush()

    invoice_article = db.query(FinanceArticle).filter_by(name="Накладна").first()
    assert invoice_article is not None

    before_date = "2027-05-01"
    after_date  = "2027-05-02"

    # Борговий запис з'являється РІВНО на after_date — до цього дня його
    # не мало бути видно на дашборді за before_date.
    db.add(Finance(finance_date=after_date, client_id=client.id, finance_type="invoice",
                    article_id=invoice_article.id, amount=999.0, sign=-1))
    db.commit()
    db.close()

    headers = {"Authorization": f"Bearer {admin_token}"}
    r_before = app_client.get(f"/api/v1/dashboard/?date_param={before_date}", headers=headers)
    r_after  = app_client.get(f"/api/v1/dashboard/?date_param={after_date}", headers=headers)
    assert r_before.status_code == 200, r_before.text
    assert r_after.status_code == 200, r_after.text

    debt_before = r_before.json()["finance"]["total_debt"]
    debt_after  = r_after.json()["finance"]["total_debt"]

    # До фіксу обидва запити повертали ідентичний результат (борг рахувався
    # без обмеження по даті) — тепер вони мають розрізнятись рівно на 999.
    assert round(debt_after - debt_before, 2) == 999.0, (
        f"дашборд мав показати різні цифри для різних дат: "
        f"before={debt_before}, after={debt_after}"
    )
