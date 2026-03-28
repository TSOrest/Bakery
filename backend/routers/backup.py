"""API для резервного копіювання, відновлення, демо-режиму та архівування."""
import json
import subprocess
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.settings import Setting
from backend.services import backup as backup_svc
from backend.services import archive as archive_svc

router = APIRouter(prefix="/backup", tags=["backup"])

ROOT    = Path(__file__).parent.parent.parent   # project root
DB_FILE = ROOT / "bakery.db"

# Файли-прапори для взаємодії з tray.py
DEMO_ACTIVE           = ROOT / "DEMO_ACTIVE"
DEMO_ENTER_REQUESTED  = ROOT / "DEMO_ENTER_REQUESTED"
DEMO_EXIT_REQUESTED   = ROOT / "DEMO_EXIT_REQUESTED"
RESTORE_REQUESTED     = ROOT / "RESTORE_REQUESTED"


def _get_settings(db: Session) -> dict:
    """Читає всі settings у вигляді {key: value}."""
    rows = db.query(Setting).all()
    return {r.key: (r.value or "") for r in rows}


def _read_version() -> str:
    f = ROOT / "VERSION"
    return f.read_text(encoding="utf-8-sig").strip() if f.exists() else ""


def _cloud_paths(cfg: dict) -> list:
    return [
        cfg.get("backup_cloud_1_path", ""),
        cfg.get("backup_cloud_2_path", ""),
        cfg.get("backup_cloud_3_path", ""),
    ]


# ── Список бекапів ─────────────────────────────────────────────────────────────

@router.get("/list")
def list_backups(db: Session = Depends(get_db)):
    cfg = _get_settings(db)
    return backup_svc.list_backups(ROOT, cfg.get("backup_local_dir", ""))


# ── Бекап зараз ────────────────────────────────────────────────────────────────

@router.post("/now")
def backup_now(db: Session = Depends(get_db)):
    cfg = _get_settings(db)
    try:
        result = backup_svc.do_backup(
            db_path=DB_FILE,
            root=ROOT,
            custom_dir=cfg.get("backup_local_dir", ""),
            keep_count=int(cfg.get("backup_keep_count", "7") or "7"),
            cloud_paths=_cloud_paths(cfg),
            app_version=_read_version(),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return result


# ── Видалити бекап ─────────────────────────────────────────────────────────────

@router.delete("/{filename}")
def delete_backup(filename: str, db: Session = Depends(get_db)):
    cfg = _get_settings(db)
    ok = backup_svc.delete_backup(ROOT, filename, cfg.get("backup_local_dir", ""))
    if not ok:
        raise HTTPException(status_code=404, detail="Бекап не знайдений")
    return {"deleted": filename}


# ── Перевірка сумісності бекапу з поточною версією ────────────────────────────

@router.get("/restore/{filename}/check")
def check_restore(filename: str, db: Session = Depends(get_db)):
    cfg = _get_settings(db)
    meta = backup_svc.get_backup_meta(ROOT, filename, cfg.get("backup_local_dir", ""))
    backup_version = meta.get("app_version", "")
    current_version = _read_version()
    compatible = (not backup_version) or (backup_version == current_version)

    # Перевіряємо чи є локальний git-тег для backup_version
    rollback_available = False
    if backup_version and not compatible:
        try:
            r = subprocess.run(
                ["git", "-C", str(ROOT), "tag", "-l", f"v{backup_version.lstrip('v')}"],
                capture_output=True, text=True, timeout=5,
            )
            rollback_available = bool(r.stdout.strip())
        except Exception:
            pass

    return {
        "compatible": compatible,
        "backup_version": backup_version,
        "current_version": current_version,
        "rollback_available": rollback_available,
        "created_at": meta.get("created_at", ""),
    }


# ── Ініціювати відновлення бекапу ─────────────────────────────────────────────

@router.post("/restore/{filename}")
def restore_backup(
    filename: str,
    rollback_first: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    """
    Пише RESTORE_REQUESTED файл — tray.py виконає відновлення
    (зупинить сервер, відновить БД, запустить сервер).
    """
    cfg = _get_settings(db)
    meta = backup_svc.get_backup_meta(ROOT, filename, cfg.get("backup_local_dir", ""))
    backup_version = meta.get("app_version", "")

    backup_dir = backup_svc._backup_dir(ROOT, cfg.get("backup_local_dir", ""))
    backup_path = str(backup_dir / filename)

    RESTORE_REQUESTED.write_text(
        json.dumps({
            "backup_path":    backup_path,
            "rollback_first": rollback_first,
            "backup_version": backup_version,
        }),
        encoding="utf-8",
    )
    return {"status": "requested", "filename": filename, "rollback_first": rollback_first}


# ── Демо режим ─────────────────────────────────────────────────────────────────

@router.get("/demo/status")
def demo_status():
    active = DEMO_ACTIVE.exists()
    since = None
    if active:
        try:
            data = json.loads(DEMO_ACTIVE.read_text(encoding="utf-8"))
            since = data.get("since", "")
        except Exception:
            pass
    demo_db_exists = (ROOT / "demo.db").exists()
    return {"active": active, "since": since, "demo_db_exists": demo_db_exists}


@router.post("/demo/enter")
def demo_enter():
    if not (ROOT / "demo.db").exists():
        raise HTTPException(status_code=404, detail="demo.db не знайдено. Спочатку згенеруйте демо базу.")
    if DEMO_ACTIVE.exists():
        raise HTTPException(status_code=400, detail="Демо режим вже активний")
    from datetime import datetime
    DEMO_ENTER_REQUESTED.write_text(
        json.dumps({"requested_at": datetime.now().isoformat(timespec="seconds")}),
        encoding="utf-8",
    )
    return {"status": "requested"}


@router.post("/demo/exit")
def demo_exit():
    if not DEMO_ACTIVE.exists():
        raise HTTPException(status_code=400, detail="Демо режим не активний")
    from datetime import datetime
    DEMO_EXIT_REQUESTED.write_text(
        json.dumps({"requested_at": datetime.now().isoformat(timespec="seconds")}),
        encoding="utf-8",
    )
    return {"status": "requested"}


# ── Архівування ────────────────────────────────────────────────────────────────

@router.get("/archive/preview")
def archive_preview(
    cutoff_date: str = Query(..., description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    try:
        date.fromisoformat(cutoff_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Невірний формат дати (YYYY-MM-DD)")

    # Не дозволяємо архівувати дані менше 1 місяця
    min_safe = (date.today() - timedelta(days=30)).isoformat()
    if cutoff_date > min_safe:
        raise HTTPException(
            status_code=400,
            detail=f"Мінімальна дата архівування: {min_safe} (30 днів тому)"
        )

    return archive_svc.get_archive_preview(db, cutoff_date)


@router.post("/archive")
def run_archive(
    cutoff_date: str = Query(..., description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    try:
        date.fromisoformat(cutoff_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Невірний формат дати (YYYY-MM-DD)")

    min_safe = (date.today() - timedelta(days=30)).isoformat()
    if cutoff_date > min_safe:
        raise HTTPException(
            status_code=400,
            detail=f"Мінімальна дата архівування: {min_safe} (30 днів тому)"
        )

    # Перед архівуванням — автобекап
    cfg = _get_settings(db)
    try:
        backup_svc.do_backup(
            db_path=DB_FILE,
            root=ROOT,
            custom_dir=cfg.get("backup_local_dir", ""),
            keep_count=int(cfg.get("backup_keep_count", "7") or "7"),
            cloud_paths=_cloud_paths(cfg),
            app_version=_read_version(),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Помилка бекапу перед архівуванням: {e}")

    try:
        result = archive_svc.run_archive(db, cutoff_date)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return result
