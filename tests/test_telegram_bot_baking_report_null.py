"""Регрес-тест на критичну знахідку QA-аудиту: команда /baking (кнопка
"🍞 Випічка") у Telegram-боті падала з TypeError, коли випічка ще не
введена повністю — baked_qty є NULL, доки результат не введено (навмисно,
не 0 — задокументована особливість системи), а _report_baking() рахував
sum()/порівнював/форматував це значення напряму. Підтверджено на реальних
даних клієнта: 53/53 і 54/54 завдань з baked_qty IS NULL — тобто команда
падала (бот мовчав) велику частину типового робочого дня.

Виправлено: baked_qty трактується як 0 у сумі; для рядків без введеного
результату показується "?" замість спроби відформатувати None.
"""

from datetime import date

from backend.models.references import Product
from backend.models.baking import BakingTask
from backend.services.telegram_bot import _report_baking

TODAY = date.today().isoformat()


def _mk_product(db, name):
    p = Product(name=name, is_active=1)
    db.add(p); db.flush()
    return p


def test_report_baking_does_not_crash_when_all_baked_qty_is_null(db_session):
    db = db_session
    p1 = _mk_product(db, "Тест-Хліб-baking-null-1")
    p2 = _mk_product(db, "Тест-Хліб-baking-null-2")
    db.add_all([
        BakingTask(task_date=TODAY, product_id=p1.id, ordered_qty=10.0, baked_qty=None),
        BakingTask(task_date=TODAY, product_id=p2.id, ordered_qty=5.0, baked_qty=None),
    ])
    db.commit()

    text = _report_baking()  # не повинно піднімати TypeError

    assert "🍞" in text
    assert "?/10" in text
    assert "?/5" in text


def test_report_baking_mixes_entered_and_not_entered(db_session):
    """Пропозиція з QA-аудиту: за замовчуванням показуються ЛИШЕ невведені
    позиції — вже введена (12/10) не дублюється в переліку, підсумок зверху
    (Замовлено/Спечено) і так рахується по УСІХ завданнях."""
    db = db_session
    p1 = _mk_product(db, "Тест-Хліб-baking-mixed-1")
    p2 = _mk_product(db, "Тест-Хліб-baking-mixed-2")
    db.add_all([
        BakingTask(task_date=TODAY, product_id=p1.id, ordered_qty=10.0, baked_qty=12.0),
        BakingTask(task_date=TODAY, product_id=p2.id, ordered_qty=5.0, baked_qty=None),
    ])
    db.commit()

    text = _report_baking()

    assert "12/10" not in text
    assert "?/5" in text
    assert "Ще не введено:" in text
