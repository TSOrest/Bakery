"""Регрес-тест: реальні логи клієнта (tmp/logs/, 3 місяці) показали 2045
однакових traceback-ів sqlalchemy.exc.PendingRollbackError (до 852/день у
пікові дні). Причина — get_current_user() (backend/routers/auth.py)
оновлює UserSession.last_used_at на кожному авторизованому запиті, а при
провалі цього commit() (найчастіше через "database is locked" при
конкурентній записі кількох операторів+бота) ковтав виняток БЕЗ
db.rollback() — сесія лишалась у стані "потрібен явний rollback()", і та ж
сесія (той самий db, Depends(get_db)) падала з PendingRollbackError на
першому ж наступному зверненні в тому самому запиті (типово — у
require_admin, при спробі прочитати user.role).

Виправлення: PRAGMA busy_timeout=5000 (backend/database.py) — зменшує
частоту самого "database is locked"; db.rollback() у except-блоці
(backend/routers/auth.py) — гарантує що сесія лишається придатною навіть
якщо лок усе ж стався.
"""

from datetime import datetime
from unittest.mock import patch

from sqlalchemy import text

from backend.database import SessionLocal
from backend.models.auth import User, UserSession
from backend.routers.auth import get_current_user


def test_busy_timeout_pragma_is_set():
    db = SessionLocal()
    try:
        value = db.execute(text("PRAGMA busy_timeout")).scalar()
        assert value and value > 0, "PRAGMA busy_timeout має бути встановлений (> 0 мс)"
    finally:
        db.close()


def test_get_current_user_rolls_back_session_on_commit_failure(db_session):
    db = db_session
    user = db.query(User).filter_by(username="admin").first()
    assert user is not None, "очікується посіяний користувач admin"

    token = "test-token-auth-rollback-regression"
    sess = UserSession(
        token=token, user_id=user.id,
        created_at=datetime.now().isoformat(), last_used_at=None,
    )
    db.add(sess)
    db.commit()

    # Змушуємо commit() усередині get_current_user() впасти рівно один раз —
    # код ловить `except Exception` широко (не конкретний тип), тож для
    # тесту достатньо будь-якого винятку; у проді це sqlite3.OperationalError
    # "database is locked".
    with patch.object(db, "commit", side_effect=Exception("database is locked")), \
         patch.object(db, "rollback", wraps=db.rollback) as rollback_spy:
        result = get_current_user(authorization=f"Bearer {token}", db=db)
        # Головна перевірка регресу: db.rollback() МАЄ бути викликаний у
        # except-блоці. Стара поведінка (except Exception: pass) лишала
        # сесію в стані PendingRollbackError — саме це спричиняло реальні
        # 500-ки в проді на наступному ж зверненні до сесії в тому самому
        # запиті (типово — require_admin).
        rollback_spy.assert_called_once()

    # Функція не мала піднімати виняток і мала повернути користувача як
    # зазвичай — провал фонового оновлення last_used_at не повинен ламати
    # авторизацію самого запиту.
    assert result is not None
    assert result.id == user.id

    # Сесія дійсно придатна для подальшої роботи (не PendingRollbackError).
    fresh = db.query(User).filter_by(id=user.id).first()
    assert fresh is not None

    db.delete(sess)
    db.commit()
