"""Регрес-тест: захисний унікальний індекс на системних клієнтах
(idx_clients_singleton_kind, міграція 030, відновлена міграцією 042).

Справжня причина дублів "Списання"/"Пайок": _seed_initial_data()
(backend/main.py) виконується на рівні МОДУЛЯ — кожен uvicorn-воркер
(reloader + child при --reload) викликає її окремо. "Чи існує клієнт цього
kind?" + вставка — класична TOCTOU-гонка: якщо два процеси проходять
перевірку майже одночасно, до commit одне одного — обидва бачать "не
існує" і обидва вставляють (НЕ import_accdb.py — той вже коректно
перевикористовує канонічного; SystemClientsTab.tsx мала окрему, додаткову
прогалину — дропдаун дозволяв обрати вже зайнятий тип, виправлено
паралельно). Міграція 030's індекс мав це блокувати, але не зміг
з'явитись, якщо дублі вже існували на момент її першого запуску
(run_migrations() ковтає помилку statement і все одно позначає міграцію
застосованою). 042 зливає дублі в канонічного і відновлює індекс;
_seed_initial_data() тепер ловить IntegrityError на commit замість падіння
воркера. Тести нижче перевіряють і сам індекс, і що гонка більше не
створює дублікат.
"""

import threading

import pytest
from sqlalchemy.exc import IntegrityError

from backend.database import SessionLocal
from backend.models.references import Client


def test_singleton_index_blocks_duplicate_ration_client(app_client, admin_token):
    db = SessionLocal()
    existing = db.query(Client).filter_by(client_kind="ration").first()
    assert existing is not None, "системний клієнт 'Пайок' має існувати після старту застосунку"

    dup = Client(full_name="Пайок-дублікат-тест", client_kind="ration", is_active=1)
    db.add(dup)
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    db.close()


def test_create_client_api_rejects_duplicate_singleton_kind(app_client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = app_client.post("/api/v1/clients/", json={
        "full_name": "Списання-дублікат-тест",
        "client_kind": "writeoff",
        "discount_pct": 0,
    }, headers=headers)
    assert resp.status_code == 409, resp.text


def test_concurrent_seed_race_does_not_duplicate_system_client(app_client, admin_token):
    """Відтворює саму гонку (два "воркери" одночасно перевіряють exists →
    вставляють) на реальних окремих з'єднаннях. Без індексу це створило б
    дублікат; з ним — один потік вставляє, другий ловить IntegrityError і
    (як тепер робить _seed_initial_data()) просто відкочується, не падаючи."""
    db = SessionLocal()
    db.query(Client).filter_by(client_kind="ration").delete()
    db.commit()
    db.close()

    errors: list[Exception] = []
    barrier = threading.Barrier(2)

    def seed_one():
        db = SessionLocal()
        try:
            barrier.wait(timeout=5)
            if not db.query(Client).filter_by(client_kind="ration").first():
                db.add(Client(full_name="Пайок", short_name="Пайок",
                               client_kind="ration", is_active=1, discount_pct=0))
            db.commit()
        except IntegrityError:
            db.rollback()
        except Exception as exc:  # noqa: BLE001 — фіксуємо будь-яку неочікувану помилку для assert нижче
            errors.append(exc)
        finally:
            db.close()

    threads = [threading.Thread(target=seed_one) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert not errors, f"неочікувані помилки під час гонки: {errors}"

    db = SessionLocal()
    count = db.query(Client).filter_by(client_kind="ration").count()
    db.close()
    assert count == 1, "гонка мала завершитись рівно одним клієнтом 'Пайок', а не дублікатом"
