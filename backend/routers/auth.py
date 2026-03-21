"""Ендпоінти авторизації: вхід, профіль, вихід, управління користувачами."""

import hashlib
import secrets
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.auth import User, UserSession

router = APIRouter(prefix="/auth", tags=["Авторизація"])

ROLES = ("operator", "accountant", "admin", "owner")
ROLE_LABELS = {
    "operator":   "Оператор",
    "accountant": "Бухгалтер",
    "admin":      "Адміністратор",
    "owner":      "Власник",
}


# ─── Хешування ───────────────────────────────────────────────────────────────

def _hash(password: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}{password}".encode()).hexdigest()


def _make_salt() -> str:
    return secrets.token_hex(16)


# ─── Dependency: поточний користувач ─────────────────────────────────────────

def get_current_user(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """Повертає поточного користувача або None (якщо не авторизований)."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.removeprefix("Bearer ").strip()
    session = db.get(UserSession, token)
    if not session:
        return None
    user = session.user
    if not user or not user.is_active:
        return None
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
    return [
        {
            "id":         u.id,
            "username":   u.username,
            "full_name":  u.full_name,
            "role":       u.role,
            "role_label": ROLE_LABELS.get(u.role, u.role),
        }
        for u in db.query(User).filter(User.is_active == 1).order_by(User.id).all()
    ]


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = (
        db.query(User)
        .filter(User.username == body.username, User.is_active == 1)
        .first()
    )
    if not user or _hash(body.password, user.salt) != user.password_hash:
        raise HTTPException(status_code=401, detail="Невірний логін або пароль")

    token = secrets.token_hex(32)
    db.add(UserSession(token=token, user_id=user.id, created_at=datetime.now().isoformat()))
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


# ─── Управління користувачами (тільки admin) ─────────────────────────────────

@router.get("/users")
def list_users(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
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
        password_hash=_hash(body.password, salt),
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
        user.password_hash = _hash(body.password, user.salt)
    db.commit()
    return {"id": user.id, "username": user.username, "role": user.role}
