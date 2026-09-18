"""Регрес-тест: POST /settings/reset-db (backend/routers/settings.py) видаляв
routes/invoices/orders, але лишав "хвости", що на них посилались:

1. invoice_transfers (таблиця переміщень товару між накладними, з'явилась у
   v1.2.0 — reset-db не оновили під неї). Після скидання+повторного імпорту
   нові invoices отримують нові id, і старі invoice_transfers лишаються
   "осиротілими" назавжди. Так на реальній базі накопичилось 61 таких рядків
   (міграція 043 прибрала їх одноразово).
2. client_groups (прив'язані до route_id) — reset-db видаляв routes, але не
   client_groups, лишаючи їх з битим route_id.
3. clients.route_id / clients.client_group_id на КЛІЄНТАХ, що лишаються
   (системні/магазин) — якщо такий клієнт мав маршрут/групу, після видалення
   routes/client_groups ці поля лишались вказувати в порожнечу.
4. audit_log (журнал змін orders/invoice_lines/finances/clients) —
   поліморфне посилання (entity_table+entity_id, без єдиного FK), тож
   PRAGMA foreign_key_check таких рядків не бачить, але вони лишались
   вказувати на записи, яких вже немає (виявлено на реальній базі — 8
   рядків після ручного тесту скидання; міграція 044 прибрала одноразово).

Усі чотири — той самий клас багу: PRAGMA foreign_keys=OFF під час reset-db
не дає впасти на биті посилання, тож вони мовчки лишаються в базі.

⚠ Навмисно `test_zz_*` (не `test_*`), щоб pytest (стандартний алфавітний
порядок збору, без рандомізації) запускав його ОСТАННІМ: reset-db видаляє
practically усі робочі дані в спільній тестовій БД — інші тести цього
модуля покладаються на дані, накопичені через SessionLocal()+commit()
(персистентні між тестами в межах одного запуску, задокументована
особливість цього проєкту), і запуск reset-db серед них зламав би їх.
"""

from sqlalchemy import text

from backend.database import SessionLocal
from backend.models.references import Client, Route, Product, ClientGroup
from backend.models.invoices import Invoice, InvoiceTransfer
from backend.models.orders import Order
from backend.models.audit import write_audit


def test_reset_db_clears_dependent_tables_and_dangling_references(app_client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}

    db = SessionLocal()
    route = Route(name="Тест-reset-route", is_active=1)
    product = Product(name="Тест-reset-продукт", is_active=1)
    db.add_all([route, product]); db.flush()

    group = ClientGroup(name="Тест-reset-група", route_id=route.id)
    db.add(group); db.flush()

    client_a = Client(full_name="Тест-reset-A", client_kind="customer", route_id=route.id, is_active=1)
    client_b = Client(full_name="Тест-reset-B", client_kind="customer", route_id=route.id, is_active=1)
    db.add_all([client_a, client_b]); db.flush()

    # Системний клієнт (лишається після reset-db, не customer) — навмисно НЕ
    # створюємо новий 'shop' (reset-db лишає лише МІН(id) кожного kind, і
    # 'shop' немає унікальності — інший тест міг уже створити такого з
    # меншим id у цьому ж прогоні, тож наш новий не пережив би дедуп).
    # 'ration' — сингтон (захищений PARTIAL UNIQUE INDEX, див.
    # test_system_client_dedup.py), гарантовано рівно один екземпляр з
    # відомим id — детерміновано незалежно від порядку тестів.
    system_client = db.query(Client).filter_by(client_kind="ration").first()
    assert system_client is not None
    system_client.route_id = route.id
    system_client.client_group_id = group.id
    system_client_id = system_client.id

    inv_a = Invoice(invoice_number="RESET-TEST-A", invoice_date="2027-09-01",
                     client_id=client_a.id, route_id=route.id, status="draft", total_sum=100.0)
    inv_b = Invoice(invoice_number="RESET-TEST-B", invoice_date="2027-09-01",
                     client_id=client_b.id, route_id=route.id, status="draft", total_sum=50.0)
    db.add_all([inv_a, inv_b]); db.flush()

    db.add(InvoiceTransfer(transfer_date="2027-09-01", source_invoice_id=inv_a.id,
                            target_invoice_id=inv_b.id, product_id=product.id, qty=2.0))

    order = Order(client_id=client_a.id, product_id=product.id, qty=5.0, order_date="2027-09-01")
    db.add(order); db.flush()
    write_audit(db, "orders", order.id, "qty", 3.0, 5.0, "test")

    db.commit()
    db.close()

    resp = app_client.post("/api/v1/settings/reset-db", headers=headers)
    assert resp.status_code == 200, resp.text

    db = SessionLocal()
    transfers_left = db.execute(text("SELECT COUNT(*) FROM invoice_transfers")).scalar()
    invoices_left  = db.execute(text("SELECT COUNT(*) FROM invoices")).scalar()
    groups_left    = db.execute(text("SELECT COUNT(*) FROM client_groups")).scalar()
    audit_left     = db.execute(text("SELECT COUNT(*) FROM audit_log")).scalar()
    fk_violations  = db.execute(text("PRAGMA foreign_key_check")).fetchall()

    system_after = db.get(Client, system_client_id)
    db.close()

    assert transfers_left == 0, "reset-db мав очистити invoice_transfers разом з invoices"
    assert invoices_left == 0
    assert groups_left == 0, "reset-db мав очистити client_groups разом з routes"
    assert audit_left == 0, "reset-db мав очистити audit_log разом з orders/invoice_lines/finances/clients"
    assert not fk_violations

    assert system_after is not None, "системний клієнт має лишитись після reset-db"
    assert system_after.route_id is None, "route_id мав обнулитись після видалення маршрутів"
    assert system_after.client_group_id is None, "client_group_id мав обнулитись після видалення груп"
