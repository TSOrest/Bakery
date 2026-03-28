"""GitHub OAuth Device Flow — авторизація пекарні через GitHub акаунт."""
import json
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

from backend.database import get_db
from backend.models.settings import Setting

router = APIRouter(prefix="/auth/github", tags=["auth-github"])

_GH_DEVICE_URL = "https://github.com/login/device/code"
_GH_TOKEN_URL  = "https://github.com/login/oauth/access_token"
_GH_API_USER   = "https://api.github.com/user"
_SCOPE         = "repo"

# Pending device flows — in-memory (single-process desktop app)
_pending: dict[str, dict] = {}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _client_creds(db: Session) -> tuple[str, str]:
    cid = db.get(Setting, "github_client_id")
    sec = db.get(Setting, "github_client_secret")
    if not (cid and cid.value):
        raise HTTPException(503, "github_client_id не налаштовано")
    if not (sec and sec.value):
        raise HTTPException(503, "github_client_secret не налаштовано")
    return cid.value, sec.value


def _post_form(url: str, params: dict[str, str]) -> dict[str, Any]:
    data = "&".join(f"{k}={v}" for k, v in params.items()).encode()
    req = Request(url, data=data, method="POST", headers={
        "Accept":       "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":   "BakeryApp/1.0",
    })
    try:
        with urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except HTTPError as e:
        raise HTTPException(e.code, f"GitHub: {e.reason}")
    except URLError as e:
        raise HTTPException(502, f"GitHub недоступний: {e.reason}")


def _get_user_info(token: str) -> dict[str, Any]:
    req = Request(_GH_API_USER, headers={
        "Authorization":        f"Bearer {token}",
        "Accept":               "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent":           "BakeryApp/1.0",
    })
    try:
        with urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except HTTPError as e:
        raise HTTPException(e.code, f"GitHub user: {e.reason}")
    except URLError as e:
        raise HTTPException(502, f"GitHub недоступний: {e.reason}")


def _upsert(db: Session, key: str, value: str, description: str = "") -> None:
    row = db.get(Setting, key)
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value, description=description))


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/start")
def start_device_flow(db: Session = Depends(get_db)):
    """Починає Device Flow — повертає user_code і URL для показу користувачу."""
    client_id, client_secret = _client_creds(db)
    resp = _post_form(_GH_DEVICE_URL, {"client_id": client_id, "scope": _SCOPE})
    if "error" in resp:
        raise HTTPException(400, resp.get("error_description", resp["error"]))

    device_code = resp["device_code"]
    _pending[device_code] = {
        "client_id":     client_id,
        "client_secret": client_secret,
        "expires_at":    time.time() + resp.get("expires_in", 900),
        "interval":      resp.get("interval", 5),
    }
    return {
        "device_code":     device_code,
        "user_code":       resp["user_code"],
        "verification_uri": resp["verification_uri"],
        "expires_in":      resp.get("expires_in", 900),
        "interval":        resp.get("interval", 5),
    }


class PollPayload(BaseModel):
    device_code: str


@router.post("/poll")
def poll_device_flow(payload: PollPayload, db: Session = Depends(get_db)):
    """Один крок polling — перевіряє чи підтвердив користувач авторизацію."""
    info = _pending.get(payload.device_code)
    if not info:
        raise HTTPException(400, "Невідомий device_code")
    if time.time() > info["expires_at"]:
        _pending.pop(payload.device_code, None)
        raise HTTPException(410, "Час авторизації вичерпано")

    resp = _post_form(_GH_TOKEN_URL, {
        "client_id":     info["client_id"],
        "client_secret": info["client_secret"],
        "device_code":   payload.device_code,
        "grant_type":    "urn:ietf:params:oauth:grant-type:device_code",
    })

    if "error" in resp:
        err = resp["error"]
        if err == "authorization_pending":
            return {"status": "pending"}
        if err == "slow_down":
            info["interval"] += 5
            return {"status": "pending"}
        _pending.pop(payload.device_code, None)
        return {"status": "access_denied" if err == "access_denied" else "expired"}

    token = resp.get("access_token")
    if not token:
        raise HTTPException(500, "Не отримано токен від GitHub")

    user_info = _get_user_info(token)
    login      = user_info.get("login", "")
    name       = user_info.get("name") or login
    avatar_url = user_info.get("avatar_url", "")

    _upsert(db, "github_oauth_token", token,      "OAuth токен акаунта пекарні на GitHub")
    _upsert(db, "github_login",       login,      "GitHub логін акаунта пекарні")
    _upsert(db, "github_name",        name,       "GitHub ім'я акаунта пекарні")
    _upsert(db, "github_avatar_url",  avatar_url, "GitHub аватар акаунта пекарні")
    db.commit()

    _pending.pop(payload.device_code, None)
    return {
        "status":     "authorized",
        "login":      login,
        "name":       name,
        "avatar_url": avatar_url,
    }


@router.get("/status")
def github_status(db: Session = Depends(get_db)):
    """Поточний статус авторизації GitHub."""
    token = db.get(Setting, "github_oauth_token")
    if not (token and token.value):
        return {"authorized": False}

    def val(key: str) -> str:
        row = db.get(Setting, key)
        return row.value if row else ""

    return {
        "authorized": True,
        "login":      val("github_login"),
        "name":       val("github_name"),
        "avatar_url": val("github_avatar_url"),
    }


@router.delete("/logout", status_code=204)
def github_logout(db: Session = Depends(get_db)):
    """Видаляє збережений OAuth токен."""
    for key in ("github_oauth_token", "github_login", "github_name", "github_avatar_url"):
        row = db.get(Setting, key)
        if row:
            row.value = ""
    db.commit()
