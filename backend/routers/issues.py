"""GitHub Issues proxy — система звернень клієнтів."""
import json
from typing import Optional
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.settings import Setting
from backend.routers.auth import get_current_user
from backend.models.auth import User

router = APIRouter(prefix="/issues", tags=["issues"])

_GITHUB_API   = "https://api.github.com"
_LABEL        = "client-report"


def _repo(db: Session) -> str:
    row = db.get(Setting, "github_repo")
    return row.value if (row and row.value) else "TSOrest/Bakery"


def _token(db: Session) -> str:
    """Повертає OAuth токен акаунта пекарні."""
    row = db.get(Setting, "github_oauth_token")
    token = row.value if row else ""
    if not token:
        raise HTTPException(503, "GitHub не авторизовано. Налаштуйте в Довідники → Налаштування")
    return token


def _github_login(db: Session) -> str:
    row = db.get(Setting, "github_login")
    return row.value if (row and row.value) else "Пекарня"


def _gh(path: str, token: str, method: str = "GET", body: dict | None = None):
    data = json.dumps(body, ensure_ascii=False).encode() if body else None
    req  = Request(
        f"{_GITHUB_API}{path}", data=data, method=method,
        headers={
            "Authorization":        f"Bearer {token}",
            "Accept":               "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent":           "BakeryApp/1.0",
            "Content-Type":         "application/json",
        },
    )
    try:
        with urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except HTTPError as e:
        raise HTTPException(e.code, f"GitHub API: {e.reason}")
    except URLError as e:
        raise HTTPException(502, f"GitHub недоступний: {e.reason}")


# ── Schemas ───────────────────────────────────────────────────────────────────

class IssueCreate(BaseModel):
    title:      str
    body:       str
    issue_type: str = "bug"   # bug | suggestion | question


class CommentCreate(BaseModel):
    body: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/")
def list_issues(db: Session = Depends(get_db)):
    """Список звернень (всі, з label client-report)."""
    tok  = _token(db)
    repo = _repo(db)
    raw  = _gh(f"/repos/{repo}/issues?labels={_LABEL}&state=all&per_page=100&sort=created&direction=asc", tok)
    return [
        {
            "number":     i["number"],
            "title":      i["title"],
            "state":      i["state"],
            "created_at": i["created_at"],
            "updated_at": i["updated_at"],
            "url":        i["html_url"],
            "body":       i.get("body") or "",
            "labels":     [lb["name"] for lb in i["labels"]],
            "comments":   i["comments"],
        }
        for i in raw
        if "pull_request" not in i
    ]


@router.get("/{number}/comments")
def list_comments(number: int, db: Session = Depends(get_db)):
    """Коментарі до звернення."""
    tok  = _token(db)
    repo = _repo(db)
    raw  = _gh(f"/repos/{repo}/issues/{number}/comments?per_page=100", tok)
    return [
        {
            "id":           c["id"],
            "body":         c.get("body") or "",
            "created_at":   c["created_at"],
            "author":       c["user"]["login"],
            "author_avatar": c["user"].get("avatar_url", ""),
        }
        for c in raw
    ]


@router.post("/{number}/comments", status_code=201)
def add_comment(
    number:  int,
    payload: CommentCreate,
    db:      Session        = Depends(get_db),
    user:    Optional[User] = Depends(get_current_user),
):
    """Додати коментар до звернення."""
    tok    = _token(db)
    repo   = _repo(db)
    gh_login = _github_login(db)
    sender   = f"{user.full_name} ({gh_login})" if user else gh_login
    body_with_sender = f"**{sender}:** {payload.body}"
    result = _gh(f"/repos/{repo}/issues/{number}/comments", tok, method="POST", body={"body": body_with_sender})
    return {"id": result["id"], "created_at": result["created_at"]}


@router.post("/assets", status_code=201)
async def upload_asset(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Завантажити скріншот у репо (Contents API) і повернути markdown-посилання.
    GitHub Issues Asset API повертає 422 Bad Size — використовуємо Contents API як обхід."""
    import base64
    from datetime import datetime

    tok      = _token(db)
    repo     = _repo(db)
    data     = await file.read()
    filename = file.filename or "screenshot.png"

    # Унікальне ім'я файлу щоб уникнути колізій
    ts   = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = f".github/issue-screenshots/{ts}_{filename}"

    result = _gh(f"/repos/{repo}/contents/{path}", tok, method="PUT", body={
        "message": f"screenshot: {filename}",
        "content": base64.b64encode(data).decode(),
    })

    raw_url = result.get("content", {}).get("download_url", "")
    if not raw_url:
        raise HTTPException(500, "GitHub не повернув URL файлу")
    return {"url": raw_url, "markdown": f"![screenshot]({raw_url})"}


@router.post("/", status_code=201)
def create_issue(
    payload: IssueCreate,
    db:      Session          = Depends(get_db),
    user:    Optional[User]   = Depends(get_current_user),
):
    """Створити нове звернення на GitHub."""
    tok  = _token(db)
    repo = _repo(db)

    type_label = {
        "bug":        "bug",
        "suggestion": "enhancement",
        "question":   "question",
    }.get(payload.issue_type, "bug")

    # Формуємо підпис: "Марія (BrunkovskaO)"
    gh_login = _github_login(db)
    if user:
        sender = f"{user.full_name} ({gh_login})"
    else:
        sender = gh_login
    full_body = f"**Від:** {sender}\n\n{payload.body}" if payload.body.strip() else f"**Від:** {sender}"

    result = _gh(f"/repos/{repo}/issues", tok, method="POST", body={
        "title":  payload.title,
        "body":   full_body,
        "labels": [_LABEL, type_label],
    })
    return {
        "number":     result["number"],
        "title":      result["title"],
        "state":      result["state"],
        "url":        result["html_url"],
        "created_at": result["created_at"],
    }
