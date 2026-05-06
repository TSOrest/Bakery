"""Ендпоінти авторизації: вхід, профіль, вихід, управління користувачами."""

import hashlib
import json
import logging
import secrets
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Request
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.auth import User, UserSession
from backend.models.settings import Setting

log = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Авторизація"])

# Rate-limit: in-memory tracking невдалих спроб login по IP.
# Не БД — ефемерне, перезавантаження сервера скидає лічильник.
# Формат: { ip: [timestamp1, timestamp2, ...] } — лише timestamp за останні 5 хв.
import time as _time
from collections import defaultdict
_LOGIN_ATTEMPTS: dict[str, list[float]] = defaultdict(list)
_LOGIN_WINDOW_SEC = 300   # 5 хв
_LOGIN_MAX_FAILS  = 5     # після 5 невдач — block
_LOGIN_BLOCK_SEC  = 300   # бан на 5 хв

def _check_rate_limit(ip: str) -> None:
    """Викидає 429 якщо забагато невдалих спроб за останні 5 хв."""
    now = _time.time()
    attempts = _LOGIN_ATTEMPTS[ip]
    # Прибираємо старі (>5 хв)
    attempts[:] = [t for t in attempts if now - t < _LOGIN_WINDOW_SEC]
    if len(attempts) >= _LOGIN_MAX_FAILS:
        # Найстаріша спроба + блок-вікно = коли можна спробувати знову
        retry_after = int(attempts[0] + _LOGIN_BLOCK_SEC - now)
        raise HTTPException(
            status_code=429,
            detail=f"Забагато невдалих спроб. Спробуйте через {max(1, retry_after)} с.",
            headers={"Retry-After": str(max(1, retry_after))},
        )

def _record_failed_login(ip: str) -> None:
    _LOGIN_ATTEMPTS[ip].append(_time.time())

def _clear_failed_logins(ip: str) -> None:
    _LOGIN_ATTEMPTS.pop(ip, None)


# Session timeout: 30 днів inactivity → invalidate
SESSION_TIMEOUT_DAYS = 30

ROLES = ("operator", "accountant", "admin", "owner", "seller")
ROLE_LABELS = {
    "operator":   "Оператор",
    "accountant": "Бухгалтер",
    "admin":      "Адміністратор",
    "owner":      "Власник",
    "seller":     "Продавець",
}


# ─── Хешування ───────────────────────────────────────────────────────────────
# Нові паролі хешуються через bcrypt. Старі (SHA256+salt) — залишаємось
# сумісними при login, з автоматичним апгрейдом до bcrypt.

try:
    import bcrypt
    _BCRYPT_AVAILABLE = True
except ImportError:
    _BCRYPT_AVAILABLE = False
    log.warning("bcrypt не встановлено — нові паролі хешуватимуться SHA256 (legacy fallback)")


def _hash_legacy(password: str, salt: str) -> str:
    """Legacy SHA256 — використовується тільки якщо bcrypt недоступний."""
    return hashlib.sha256(f"{salt}{password}".encode()).hexdigest()


def _hash_bcrypt(password: str) -> str:
    """Хешує пароль через bcrypt (cost=12). Salt вбудований у hash."""
    h = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12))
    return h.decode("utf-8")


def _hash_password(password: str, salt: str) -> str:
    """Створює новий хеш — bcrypt (нове) або SHA256 (fallback)."""
    if _BCRYPT_AVAILABLE:
        return _hash_bcrypt(password)
    return _hash_legacy(password, salt)


def _is_bcrypt_hash(h: str) -> bool:
    return isinstance(h, str) and h.startswith(("$2a$", "$2b$", "$2y$"))


def _verify_password(password: str, password_hash: str, salt: str) -> bool:
    """Перевіряє пароль проти збереженого хешу — підтримує bcrypt і legacy SHA256."""
    if not password_hash:
        return False
    if _is_bcrypt_hash(password_hash):
        if not _BCRYPT_AVAILABLE:
            return False
        try:
            return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
        except Exception:
            return False
    # Legacy SHA256
    return _hash_legacy(password, salt) == password_hash


def _make_salt() -> str:
    return secrets.token_hex(16)


# ─── Dependency: поточний користувач ─────────────────────────────────────────

def get_current_user(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """Повертає поточного користувача або None (якщо не авторизований).
    Перевіряє таймаут сесії і оновлює last_used_at при кожному запиті."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.removeprefix("Bearer ").strip()
    session = db.get(UserSession, token)
    if not session:
        return None
    user = session.user
    if not user or not user.is_active:
        return None

    # Перевірка таймауту (30 днів неактивності)
    from datetime import timedelta
    last = session.last_used_at or session.created_at
    if last:
        try:
            last_dt = datetime.fromisoformat(last)
            if datetime.now() - last_dt > timedelta(days=SESSION_TIMEOUT_DAYS):
                # Сесія прострочена — видаляємо
                db.delete(session)
                db.commit()
                return None
        except (ValueError, TypeError):
            pass

    # Оновлюємо last_used_at — раз на хвилину достатньо щоб не спамити write-и
    try:
        now = datetime.now()
        if not session.last_used_at:
            session.last_used_at = now.isoformat()
            db.commit()
        else:
            last_dt = datetime.fromisoformat(session.last_used_at)
            if (now - last_dt).total_seconds() > 60:
                session.last_used_at = now.isoformat()
                db.commit()
    except Exception:
        pass

    return user


def require_user(user: Optional[User] = Depends(get_current_user)) -> User:
    """Залежність яка вимагає авторизації."""
    if not user:
        raise HTTPException(status_code=401, detail="Не авторизовано")
    return user


def require_admin(user: User = Depends(require_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Потрібні права адміністратора")
    return user


def require_system_perm(
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> User:
    """Дозволяє доступ адміну або будь-якій ролі з дозволом admin_system."""
    if user.role == "admin":
        return user
    setting = db.get(Setting, "role_permissions")
    if setting and setting.value:
        try:
            perms: dict = json.loads(setting.value)
            if "admin_system" in perms.get(user.role, []):
                return user
        except (ValueError, TypeError):
            pass
    raise HTTPException(status_code=403, detail="Потрібні права адміністратора або дозвіл admin_system")


# ─── Схеми ───────────────────────────────────────────────────────────────────

class LoginIn(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id:        int
    username:  str
    full_name: str
    role:      str
    role_label: str

    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    username:  str
    password:  str
    full_name: str = ""
    role:      str = "operator"


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role:      Optional[str] = None
    password:  Optional[str] = None
    is_active: Optional[int] = None


# ─── Ендпоінти ───────────────────────────────────────────────────────────────

@router.get("/public-users")
def list_users_public(db: Session = Depends(get_db)):
    """Публічний список активних користувачів для екрану входу (без паролів)."""
    ROLE_ORDER = {"operator": 0, "accountant": 1, "owner": 2, "admin": 3, "seller": 4}
    users = db.query(User).filter(User.is_active == 1).all()
    users.sort(key=lambda u: (ROLE_ORDER.get(u.role, 99), u.id))
    return [
        {
            "id":         u.id,
            "username":   u.username,
            "full_name":  u.full_name,
            "role":       u.role,
            "role_label": ROLE_LABELS.get(u.role, u.role),
        }
        for u in users
    ]


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    # Rate-limit: 5 невдалих спроб з одного IP за 5 хв → 429
    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(client_ip)

    user = (
        db.query(User)
        .filter(User.username == body.username, User.is_active == 1)
        .first()
    )
    if not user or not _verify_password(body.password, user.password_hash, user.salt):
        _record_failed_login(client_ip)
        raise HTTPException(status_code=401, detail="Невірний логін або пароль")
    _clear_failed_logins(client_ip)

    # Auto-upgrade legacy SHA256 → bcrypt при успішному login
    if _BCRYPT_AVAILABLE and not _is_bcrypt_hash(user.password_hash):
        try:
            user.password_hash = _hash_bcrypt(body.password)
            user.salt = _make_salt()  # salt тепер не потрібен але залишаємо для сумісності
            db.flush()
        except Exception as exc:
            log.warning("Failed to upgrade password hash for user %s: %s", user.username, exc)

    token = secrets.token_hex(32)
    now_iso = datetime.now().isoformat()
    db.add(UserSession(token=token, user_id=user.id, created_at=now_iso, last_used_at=now_iso))
    db.commit()

    return {
        "token": token,
        "user": {
            "id":         user.id,
            "username":   user.username,
            "full_name":  user.full_name,
            "role":       user.role,
            "role_label": ROLE_LABELS.get(user.role, user.role),
        },
    }


@router.get("/me")
def me(user: User = Depends(require_user)):
    return {
        "id":         user.id,
        "username":   user.username,
        "full_name":  user.full_name,
        "role":       user.role,
        "role_label": ROLE_LABELS.get(user.role, user.role),
    }


@router.post("/logout")
def logout(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
        session = db.get(UserSession, token)
        if session:
            db.delete(session)
            db.commit()
    return {"ok": True}


# ─── Управління користувачами ────────────────────────────────────────────────

@router.get("/users")
def list_users(admin: User = Depends(require_system_perm), db: Session = Depends(get_db)):
    return [
        {
            "id":        u.id,
            "username":  u.username,
            "full_name": u.full_name,
            "role":      u.role,
            "role_label": ROLE_LABELS.get(u.role, u.role),
            "is_active": u.is_active,
        }
        for u in db.query(User).order_by(User.id).all()
    ]


@router.post("/users", status_code=201)
def create_user(body: UserCreate, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(status_code=400, detail="Логін вже зайнятий")
    if body.role not in ROLES:
        raise HTTPException(status_code=400, detail=f"Роль має бути одна з: {ROLES}")
    salt = _make_salt()
    user = User(
        username=body.username,
        password_hash=_hash_password(body.password, salt),
        salt=salt,
        full_name=body.full_name,
        role=body.role,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Користувач з логіном «{body.username}» вже існує")
    db.refresh(user)
    return {"id": user.id, "username": user.username, "role": user.role}


@router.put("/users/{user_id}")
def update_user(
    user_id: int,
    body: UserUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")
    if body.full_name is not None:
        user.full_name = body.full_name
    if body.role is not None:
        if body.role not in ROLES:
            raise HTTPException(status_code=400, detail=f"Роль має бути одна з: {ROLES}")
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.password:
        user.salt = _make_salt()
        user.password_hash = _hash_password(body.password, user.salt)
    db.commit()
    return {"id": user.id, "username": user.username, "role": user.role}
