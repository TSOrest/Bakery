"""GitHub Issues proxy — система звернень клієнтів."""
import json
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.settings import Setting

router = APIRouter(prefix="/issues", tags=["issues"])

_GITHUB_API = "https://api.github.com"
_LABEL      = "client-report"


def _repo(db: Session) -> str:
    row = db.get(Setting, "github_repo")
    return row.value if (row and row.value) else "TSOrest/Bakery"


def _token(db: Session) -> str:
    row = db.get(Setting, "github_issues_token")
    token = row.value if row else ""
    if not token:
        raise HTTPException(503, "GitHub Issues token не налаштовано")
    return token


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


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/")
def list_issues(db: Session = Depends(get_db)):
    """Список звернень (всі, з label client-report)."""
    tok  = _token(db)
    repo = _repo(db)
    raw  = _gh(f"/repos/{repo}/issues?labels={_LABEL}&state=all&per_page=100&sort=created&direction=desc", tok)
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
        if "pull_request" not in i   # skip PRs
    ]


@router.post("/", status_code=201)
def create_issue(payload: IssueCreate, db: Session = Depends(get_db)):
    """Створити нове звернення на GitHub."""
    tok  = _token(db)
    repo = _repo(db)

    type_label = {
        "bug":        "bug",
        "suggestion": "enhancement",
        "question":   "question",
    }.get(payload.issue_type, "bug")

    result = _gh(f"/repos/{repo}/issues", tok, method="POST", body={
        "title":  payload.title,
        "body":   payload.body,
        "labels": [_LABEL, type_label],
    })
    return {
        "number":     result["number"],
        "title":      result["title"],
        "state":      result["state"],
        "url":        result["html_url"],
        "created_at": result["created_at"],
    }
