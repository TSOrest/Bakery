"""Регрес-тест: PUT /clients/{id} (backend/routers/clients.py, update_client)
раніше збирав тіло оновлення через `data.model_dump(exclude_none=True)` — це
викидало з патча БУДЬ-ЯКЕ поле зі значенням null, незалежно від того, чи
оператор навмисно надіслав його як null (щоб очистити), чи просто не вказав
у формі. Через це "зняти маршрут" (route_id -> null), "очистити адресу",
"очистити телефон" тощо НІКОЛИ не спрацьовувало — значення в базі мовчки
лишалось старим (форма ClientsTab.tsx завжди шле ВСІ поля, включно з
навмисним null). Виправлено на exclude_unset=True, яке коректно розрізняє
"поле не надіслане" (частковий PATCH, напр. кнопка "Відновити" шле лише
{is_active: 1}) від "поле надіслане як null".
"""

from backend.database import SessionLocal
from backend.models.references import Client, Route


def test_put_client_clears_route_id_when_explicitly_null(app_client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    db = SessionLocal()
    route = Route(name="Тест-маршрут-clear", is_active=1)
    db.add(route); db.flush()
    client = Client(full_name="Тест-клієнт-route-clear", client_kind="customer",
                     route_id=route.id, is_active=1)
    db.add(client); db.commit()
    client_id, route_id = client.id, route.id
    db.close()

    resp = app_client.put(f"/api/v1/clients/{client_id}", json={
        "full_name": "Тест-клієнт-route-clear",
        "route_id": None,
        "discount_pct": 0,
    }, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["route_id"] is None, "route_id мав очиститись до null, а не лишитись старим"

    db = SessionLocal()
    reloaded = db.get(Client, client_id)
    assert reloaded.route_id is None
    db.close()


def test_put_client_partial_payload_does_not_touch_other_fields(app_client, admin_token):
    """Кнопка 'Відновити' шле лише {is_active: 1} — решта полів (напр. адреса)
    мають лишитись як були, а не скинутись у null через exclude_unset."""
    headers = {"Authorization": f"Bearer {admin_token}"}
    db = SessionLocal()
    client = Client(full_name="Тест-клієнт-partial", client_kind="customer",
                     address="вул. Тестова, 1", is_active=0)
    db.add(client); db.commit()
    client_id = client.id
    db.close()

    resp = app_client.put(f"/api/v1/clients/{client_id}", json={"is_active": 1}, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_active"] == 1
    assert resp.json()["address"] == "вул. Тестова, 1", "адреса не мала зникнути від часткового PATCH"
