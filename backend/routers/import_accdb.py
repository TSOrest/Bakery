"""Роутер імпорту даних з Microsoft Access (.accdb)."""

from __future__ import annotations

import os
import threading
import uuid
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.finances import Finance
from backend.models.orders import Order
from backend.models.pricing import ClientPriceOverride, Price
from backend.models.references import Category, Client, Product, Route, Unit
from backend.schemas.import_accdb import (
    AccdbPreview, ImportContext, ImportMapping, ImportReport,
    ExistingClient, ExistingRoute, ExistingCategory,
)
from backend.schemas.api_responses import (
    AccdbDbStatus, AccdbDriverCheck, AccdbImportStatus, AccdbImportStart,
)
from backend.services import import_accdb as svc

router = APIRouter(prefix="/import", tags=["import"])

ROOT     = Path(__file__).parent.parent.parent
DATA_DIR = Path(os.environ.get("BAKERY_DATA_DIR", ROOT))
TMP_DIR  = DATA_DIR / "tmp"


def _tmp_path(token: str) -> Path:
    return TMP_DIR / f"import_{token}.accdb"


def _cleanup_old_tmp() -> None:
    """Видаляє тимчасові файли старші 24 годин."""
    if not TMP_DIR.exists():
        return
    cutoff = datetime.now() - timedelta(hours=24)
    for f in TMP_DIR.glob("import_*.accdb"):
        try:
            if datetime.fromtimestamp(f.stat().st_mtime) < cutoff:
                f.unlink(missing_ok=True)
        except OSError:
            pass


@router.get("/db-status", response_model=AccdbDbStatus)
def db_status(db: Session = Depends(get_db)):
    """
    Повертає кількість записів у всіх цільових таблицях імпорту.
    Якщо total > 0 — БД потребує скидання перед імпортом.
    """
    from sqlalchemy import func as sqlfunc
    counts = {
        "clients":   db.query(sqlfunc.count(Client.id)).filter(Client.client_kind == "customer").scalar() or 0,
        "products":  db.query(sqlfunc.count(Product.id)).scalar() or 0,
        "routes":    db.query(sqlfunc.count(Route.id)).scalar() or 0,
        "units":     db.query(sqlfunc.count(Unit.id)).scalar() or 0,
        "prices":    db.query(sqlfunc.count(Price.id)).scalar() or 0,
        "overrides": db.query(sqlfunc.count(ClientPriceOverride.id)).scalar() or 0,
        "orders":    db.query(sqlfunc.count(Order.id)).scalar() or 0,
        "finances":  db.query(sqlfunc.count(Finance.id)).scalar() or 0,
    }
    total = sum(counts.values())
    return {"total": total, "counts": counts}


@router.get("/driver-check", response_model=AccdbDriverCheck)
def driver_check():
    """Перевіряє наявність Microsoft Access ODBC Driver."""
    err = svc.check_access_driver()
    return {"ok": err is None, "error": err}


@router.post("/upload", response_model=AccdbPreview)
async def upload_accdb(
    file: UploadFile = File(...),
    password: str = Form(""),
):
    """
    Завантажує .accdb файл, зберігає у тимчасову папку і повертає попередній перегляд.
    Якщо файл захищений паролем — передати поле 'password'.
    """
    if not file.filename or not file.filename.lower().endswith(".accdb"):
        raise HTTPException(400, "Файл повинен мати розширення .accdb")

    driver_err = svc.check_access_driver()
    if driver_err:
        raise HTTPException(503, driver_err)

    TMP_DIR.mkdir(parents=True, exist_ok=True)
    _cleanup_old_tmp()

    token = uuid.uuid4().hex
    tmp_file = _tmp_path(token)

    content = await file.read()
    tmp_file.write_bytes(content)

    try:
        preview = svc.read_accdb_preview(str(tmp_file), password)
    except RuntimeError as exc:
        tmp_file.unlink(missing_ok=True)
        raise HTTPException(503, str(exc))
    except Exception as exc:
        tmp_file.unlink(missing_ok=True)
        raise HTTPException(500, f"Помилка читання файлу: {exc}")

    preview.temp_file_token = token
    return preview


@router.post("/run", response_model=AccdbImportStart)
def run_import(mapping: ImportMapping):
    """
    Запускає імпорт у фоновому потоці. Повертає {"status": "started"}.
    """
    status = svc.get_import_status()
    if status.get("running"):
        raise HTTPException(409, "Імпорт вже виконується")

    tmp_file = _tmp_path(mapping.temp_file_token)
    if not tmp_file.exists():
        raise HTTPException(404, "Тимчасовий файл не знайдено. Завантажте .accdb заново.")

    thread = threading.Thread(
        target=svc.run_import,
        args=(str(tmp_file), mapping),
        daemon=True,
    )
    thread.start()
    return {"status": "started"}


@router.get("/status", response_model=AccdbImportStatus)
def import_status():
    """Повертає поточний стан імпорту (step, progress, error)."""
    state = svc.get_import_status()
    # Не повертаємо великий result у /status — він є у /result
    return {
        "running":  state.get("running", False),
        "step":     state.get("step", ""),
        "progress": state.get("progress", 0),
        "error":    state.get("error"),
    }


@router.get("/context", response_model=ImportContext)
def import_context(db: Session = Depends(get_db)):
    """Повертає існуючі сутності БД для merge-маппінгу в wizard."""
    clients = (
        db.query(Client)
        .filter(Client.is_active == 1)
        .order_by(Client.full_name)
        .all()
    )
    routes = db.query(Route).order_by(Route.sort_order, Route.name).all()
    cats   = db.query(Category).order_by(Category.sort_order, Category.name).all()

    return ImportContext(
        existing_clients=[
            ExistingClient(
                id=c.id, full_name=c.full_name,
                short_name=c.short_name, client_kind=c.client_kind or "customer",
            )
            for c in clients
        ],
        existing_routes=[
            ExistingRoute(id=r.id, name=r.name, sort_order=r.sort_order or 0)
            for r in routes
        ],
        existing_categories=[
            ExistingCategory(id=c.id, name=c.name, is_baked=c.is_baked or 1, sort_order=c.sort_order or 0)
            for c in cats
        ],
    )


@router.get("/result", response_model=ImportReport)
def import_result():
    """Повертає звіт завершеного імпорту або 404 якщо ще не готовий."""
    state = svc.get_import_status()
    result = state.get("result")
    if result is None:
        raise HTTPException(404, "Результат імпорту ще не готовий")
    return result
