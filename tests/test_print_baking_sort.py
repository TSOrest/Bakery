"""Регрес-тест: друковане "Завдання пекарям" (GET /print/baking) має
показувати вироби в алфавітному порядку за назвою, а не за product_id
(порядком внесення в довідник) — раніше `.order_by(BakingTask.product_id)`
визначав і порядок рядків у друкованій формі, плутаючи пекарів при пошуку
виробу в списку.
"""

from backend.database import SessionLocal
from backend.models.references import Category, Product
from backend.models.baking import BakingTask

TASK_DATE = "2027-08-15"


def test_baking_print_sorted_alphabetically_not_by_id(app_client):
    db = SessionLocal()
    try:
        cat = Category(name="Тест-Хліб-Сортування", is_baked=1, is_active=1, sort_order=1)
        db.add(cat); db.flush()

        # Навмисно створюємо вироби в НЕалфавітному порядку — product_id
        # зростає у порядку вставки (Я, А, М), очікуваний друкований
        # порядок — алфавітний (А, М, Я).
        p_ya = Product(name="Я-тест-виріб", category_id=cat.id, is_active=1)
        p_a  = Product(name="А-тест-виріб", category_id=cat.id, is_active=1)
        p_m  = Product(name="М-тест-виріб", category_id=cat.id, is_active=1)
        db.add_all([p_ya, p_a, p_m]); db.flush()

        for p in (p_ya, p_a, p_m):
            db.add(BakingTask(task_date=TASK_DATE, product_id=p.id, ordered_qty=1, recommended_qty=1))
        db.commit()
    finally:
        db.close()

    r = app_client.get(f"/api/v1/print/baking?task_date={TASK_DATE}")
    assert r.status_code == 200, r.text
    html = r.text

    idx_a  = html.index("А-тест-виріб")
    idx_m  = html.index("М-тест-виріб")
    idx_ya = html.index("Я-тест-виріб")
    assert idx_a < idx_m < idx_ya, "рядки мають йти в алфавітному порядку А → М → Я"
