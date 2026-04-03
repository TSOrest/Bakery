"""Роутер імпорту даних з Microsoft Access (.accdb)."""

from __future__ import annotations

import os
import threading
import uuid
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse

from backend.schemas.import_accdb import AccdbPreview, ImportMapping, ImportReport
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


@router.post("/upload", response_model=AccdbPreview)
async def upload_accdb(file: UploadFile = File(...)):
    """
    Завантажує .accdb файл, зберігає у тимчасову папку і повертає попередній перегляд.
    """
    if not file.filename or not file.filename.lower().endswith(".accdb"):
        raise HTTPException(400, "Файл повинен мати розширення .accdb")

    TMP_DIR.mkdir(parents=True, exist_ok=True)
    _cleanup_old_tmp()

    token = uuid.uuid4().hex
    tmp_file = _tmp_path(token)

    content = await file.read()
    tmp_file.write_bytes(content)

    try:
        preview = svc.read_accdb_preview(str(tmp_file))
    except RuntimeError as exc:
        tmp_file.unlink(missing_ok=True)
        raise HTTPException(503, str(exc))
    except Exception as exc:
        tmp_file.unlink(missing_ok=True)
        raise HTTPException(500, f"Помилка читання файлу: {exc}")

    preview.temp_file_token = token
    return preview


@router.post("/run")
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


@router.get("/status")
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


@router.get("/result", response_model=ImportReport)
def import_result():
    """Повертає звіт завершеного імпорту або 404 якщо ще не готовий."""
    state = svc.get_import_status()
    result = state.get("result")
    if result is None:
        raise HTTPException(404, "Результат імпорту ще не готовий")
    return result
