"""API для резервного копіювання, відновлення, демо-режиму та архівування."""
import json
import logging
import os
import subprocess
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.settings import Setting
from backend.services import backup as backup_svc
from backend.services import archive as archive_svc
from backend.schemas.api_responses import (
    CloudFolders, StatusDetail, DemoStatus, DemoActionResult,
    RestoreCheckResult, RestoreRequest, UploadBackupResult, DeleteResult,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/backup", tags=["backup"])

ROOT     = Path(__file__).parent.parent.parent   # project root (code)
DATA_DIR = Path(os.environ.get("BAKERY_DATA_DIR", ROOT))
DB_FILE  = DATA_DIR / "bakery.db"

# Файли-прапори для взаємодії з tray.py
DEMO_ACTIVE           = DATA_DIR / "DEMO_ACTIVE"
DEMO_ENTER_REQUESTED  = DATA_DIR / "DEMO_ENTER_REQUESTED"
DEMO_EXIT_REQUESTED   = DATA_DIR / "DEMO_EXIT_REQUESTED"
RESTORE_REQUESTED     = DATA_DIR / "RESTORE_REQUESTED"


def _save_setting(db: Session, key: str, value: str) -> None:
    s = db.get(Setting, key)
    if s:
        s.value = value
    else:
        db.add(Setting(key=key, value=value, description=""))
    db.commit()


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
    return backup_svc.list_backups(DATA_DIR, cfg.get("backup_local_dir", ""))


# ── Бекап зараз ────────────────────────────────────────────────────────────────

@router.post("/now")
def backup_now(db: Session = Depends(get_db)):
    cfg = _get_settings(db)
    try:
        result = backup_svc.do_backup(
            db_path=DB_FILE,
            root=DATA_DIR,
            custom_dir=cfg.get("backup_local_dir", ""),
            keep_count=int(cfg.get("backup_keep_count", "7") or "7"),
            cloud_paths=_cloud_paths(cfg),
            app_version=_read_version(),
            max_disk_mb=int(cfg.get("backup_max_disk_mb", "0") or "0"),
        )
    except Exception as e:
        log.exception("Backup creation failed")
        raise HTTPException(status_code=500, detail="Не вдалося створити бекап. Деталі — у логах сервера.")
    return result


# ── Видалити бекап ─────────────────────────────────────────────────────────────

@router.delete("/{filename}", response_model=DeleteResult)
def delete_backup(filename: str, db: Session = Depends(get_db)):
    cfg = _get_settings(db)
    ok = backup_svc.delete_backup(DATA_DIR, filename, cfg.get("backup_local_dir", ""))
    if not ok:
        raise HTTPException(status_code=404, detail="Бекап не знайдений")
    return {"deleted": filename}


# ── Хмарна синхронізація (через локальні sync-папки) ──────────────────────────

def _detect_sync_folders() -> dict:
    """
    Визначає папки синхронізації хмарних сховищ встановлених на Windows.
    Google Drive / OneDrive / Dropbox desktop-клієнти синхронізують локальну
    папку з хмарою — ми просто копіюємо бекап туди.
    """
    home = Path.home()
    result: dict[str, Optional[str]] = {"google": None, "onedrive": None, "dropbox": None}

    # OneDrive — надійніше через env-змінну
    for env in ("OneDrive", "OneDriveConsumer", "OneDriveCommercial"):
        p = os.environ.get(env, "")
        if p and Path(p).is_dir():
            result["onedrive"] = p
            break
    if not result["onedrive"]:
        for candidate in [home / "OneDrive", home / "OneDrive - Personal"]:
            if candidate.is_dir():
                result["onedrive"] = str(candidate)
                break

    # Google Drive — кілька варіантів назви
    for candidate in [
        home / "Google Drive",
        home / "My Drive",
        home / "Google Drive (My Drive)",
        home / "GoogleDrive",
    ]:
        if candidate.is_dir():
            result["google"] = str(candidate)
            break

    # Dropbox — читаємо info.json
    for info_path in [
        Path(os.environ.get("LOCALAPPDATA", "")) / "Dropbox" / "info.json",
        Path(os.environ.get("APPDATA", "")) / "Dropbox" / "info.json",
    ]:
        if info_path.exists():
            try:
                info = json.loads(info_path.read_text(encoding="utf-8"))
                path = (info.get("personal") or info.get("business") or {}).get("path", "")
                if path and Path(path).is_dir():
                    result["dropbox"] = path
                    break
            except Exception as exc:
                log.debug("Failed to parse Dropbox info.json: %s", exc)

    return result


@router.get("/cloud/detect", response_model=CloudFolders)
def cloud_detect():
    """Повертає автоматично виявлені папки синхронізації хмарних провайдерів."""
    return _detect_sync_folders()


@router.post("/cloud/test", response_model=StatusDetail)
def cloud_test(body: dict):
    """
    Перевіряє чи папка хмарної синхронізації доступна для запису.

    Логіка: пишемо тимчасовий файл `.bakery_sync_test_<TS>`, перевіряємо
    що він з'явився, потім видаляємо. НЕ перевіряє чи відбулась
    реальна синхронізація з хмарою (це залежить від клієнт-додатка
    хмари і не контролюється з нашого боку — користувач має сам
    переконатись що клієнт хмари запущений).

    Body: {"path": "/path/to/cloud/folder"}
    Response: {"status": "ok"|"error", "detail": "..."}
    """
    import time
    raw_path = (body or {}).get("path", "").strip()
    if not raw_path:
        raise HTTPException(status_code=400, detail="path обов'язковий")

    p = Path(raw_path)
    if not p.exists():
        return {"status": "error", "detail": f"Папка не існує: {raw_path}"}
    if not p.is_dir():
        return {"status": "error", "detail": "Шлях не є папкою"}

    test_name = f".bakery_sync_test_{int(time.time())}"
    test_file = p / test_name
    try:
        test_file.write_text("ok", encoding="utf-8")
        if not test_file.exists():
            return {"status": "error", "detail": "Не вдалось записати тестовий файл"}
        # Cleanup
        test_file.unlink(missing_ok=True)
        return {
            "status": "ok",
            "detail": "Папка доступна для запису. Переконайтесь що клієнт хмари (OneDrive/Drive/Dropbox) запущений і синхронізується.",
        }
    except PermissionError:
        return {"status": "error", "detail": "Немає прав на запис у папку"}
    except OSError as exc:
        return {"status": "error", "detail": f"Помилка запису: {exc}"}


# ── Завантажити файл бекапу (SaveFile) ────────────────────────────────────────

@router.get("/download/{filename}")
def download_backup(filename: str, db: Session = Depends(get_db)):
    """Повертає файл бекапу для збереження користувачем."""
    cfg = _get_settings(db)
    backup_dir = backup_svc._backup_dir(DATA_DIR, cfg.get("backup_local_dir", ""))
    path = backup_dir / filename
    if not path.exists() or not path.name.startswith("bakery_") or path.suffix != ".db":
        raise HTTPException(status_code=404, detail="Бекап не знайдений")
    return FileResponse(
        path=str(path),
        media_type="application/octet-stream",
        filename=filename,
    )


# ── Імпортувати файл бекапу (OpenFile) ─────────────────────────────────────────

@router.post("/upload", response_model=UploadBackupResult)
async def upload_backup(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Приймає .db файл і зберігає його в папку бекапів."""
    if not file.filename or not file.filename.endswith(".db"):
        raise HTTPException(status_code=400, detail="Файл має мати розширення .db")
    cfg = _get_settings(db)
    backup_dir = backup_svc._backup_dir(DATA_DIR, cfg.get("backup_local_dir", ""))
    backup_dir.mkdir(parents=True, exist_ok=True)

    # Безпечна назва файлу — лишаємо тільки допустимі символи
    import re
    safe_name = re.sub(r"[^\w.\-]", "_", file.filename)
    dest = backup_dir / safe_name
    content = await file.read()
    dest.write_bytes(content)

    # Перевірка цілісності: файл має бути дійсною SQLite БД
    import sqlite3 as _sqlite3
    try:
        conn = _sqlite3.connect(f"file:{dest}?mode=ro", uri=True)
        row = conn.execute("PRAGMA quick_check(1)").fetchone()
        conn.close()
        if not row or row[0] != "ok":
            dest.unlink(missing_ok=True)
            raise HTTPException(
                status_code=400,
                detail=f"Файл пошкоджений (PRAGMA quick_check: {row[0] if row else '?'}). "
                       "Завантажте бекап, створений через меню Налаштування → Бекап.",
            )
    except HTTPException:
        raise
    except _sqlite3.DatabaseError as exc:
        log.warning("Uploaded backup is not valid SQLite: %s", exc)
        dest.unlink(missing_ok=True)
        raise HTTPException(
            status_code=400,
            detail="Файл не є дійсною базою SQLite. "
                   "Завантажте бекап, створений через меню Налаштування → Бекап.",
        )

    # Мінімальний meta-файл
    import json as _json
    from datetime import datetime
    meta = {
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "app_version": _read_version(),
        "imported": True,
    }
    dest.with_suffix(".meta.json").write_text(_json.dumps(meta))

    return {"filename": safe_name, "size_kb": round(len(content) / 1024, 1)}


# ── Перевірка сумісності бекапу з поточною версією ────────────────────────────

@router.get("/restore/{filename}/check", response_model=RestoreCheckResult)
def check_restore(filename: str, db: Session = Depends(get_db)):
    cfg = _get_settings(db)
    meta = backup_svc.get_backup_meta(DATA_DIR, filename, cfg.get("backup_local_dir", ""))
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
        except Exception as exc:
            log.warning("git tag check failed: %s", exc)

    return {
        "compatible": compatible,
        "backup_version": backup_version,
        "current_version": current_version,
        "rollback_available": rollback_available,
        "created_at": meta.get("created_at", ""),
    }


# ── Ініціювати відновлення бекапу ─────────────────────────────────────────────

@router.post("/restore/{filename}", response_model=RestoreRequest)
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
    meta = backup_svc.get_backup_meta(DATA_DIR, filename, cfg.get("backup_local_dir", ""))
    backup_version = meta.get("app_version", "")

    backup_dir = backup_svc._backup_dir(DATA_DIR, cfg.get("backup_local_dir", ""))
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

@router.get("/demo/status", response_model=DemoStatus)
def demo_status():
    active = DEMO_ACTIVE.exists()
    since = None
    if active:
        try:
            data = json.loads(DEMO_ACTIVE.read_text(encoding="utf-8"))
            since = data.get("since", "")
        except Exception as exc:
            log.debug("Failed to read demo state file: %s", exc)
    demo_db_exists = (DATA_DIR / "demo.db").exists()
    return {"active": active, "since": since, "demo_db_exists": demo_db_exists}


@router.post("/demo/enter", response_model=DemoActionResult)
def demo_enter():
    if not (DATA_DIR / "demo.db").exists():
        raise HTTPException(status_code=404, detail="demo.db не знайдено. Спочатку згенеруйте демо базу.")
    if DEMO_ACTIVE.exists():
        raise HTTPException(status_code=400, detail="Демо режим вже активний")
    from datetime import datetime
    DEMO_ENTER_REQUESTED.write_text(
        json.dumps({"requested_at": datetime.now().isoformat(timespec="seconds")}),
        encoding="utf-8",
    )
    return {"status": "requested"}


@router.post("/demo/exit", response_model=DemoActionResult)
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
            root=DATA_DIR,
            custom_dir=cfg.get("backup_local_dir", ""),
            keep_count=int(cfg.get("backup_keep_count", "7") or "7"),
            cloud_paths=_cloud_paths(cfg),
            app_version=_read_version(),
            max_disk_mb=int(cfg.get("backup_max_disk_mb", "0") or "0"),
        )
    except Exception as e:
        log.exception("Backup-before-archive failed")
        raise HTTPException(status_code=500, detail="Помилка створення бекапу перед архівуванням. Архівування скасовано.")

    try:
        result = archive_svc.run_archive(db, cutoff_date)
    except Exception as e:
        log.exception("Archive run failed")
        raise HTTPException(status_code=500, detail="Помилка архівування. Бекап успішно створено — дані в безпеці.")

    return result
