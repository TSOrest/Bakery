"""API для резервного копіювання, відновлення, демо-режиму та архівування."""
import json
import logging
import subprocess
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, Response
from sqlalchemy.orm import Session

from backend.database import SessionLocal, get_db
from backend.models.settings import Setting
from backend.services import backup as backup_svc
from backend.services import archive as archive_svc
from backend.services import cloud_backup as cloud_svc

log = logging.getLogger(__name__)

router = APIRouter(prefix="/backup", tags=["backup"])

ROOT    = Path(__file__).parent.parent.parent   # project root
DB_FILE = ROOT / "bakery.db"

# Файли-прапори для взаємодії з tray.py
DEMO_ACTIVE           = ROOT / "DEMO_ACTIVE"
DEMO_ENTER_REQUESTED  = ROOT / "DEMO_ENTER_REQUESTED"
DEMO_EXIT_REQUESTED   = ROOT / "DEMO_EXIT_REQUESTED"
RESTORE_REQUESTED     = ROOT / "RESTORE_REQUESTED"


def _save_setting(db: Session, key: str, value: str) -> None:
    s = db.get(Setting, key)
    if s:
        s.value = value
    else:
        db.add(Setting(key=key, value=value, description=""))
    db.commit()


def _cloud_upload_bg(backup_path: str) -> None:
    """Завантажує бекап у підключені хмари. Запускається у фоні."""
    db = SessionLocal()
    try:
        cfg = _get_settings(db)
        folder = cfg.get("cloud_folder_name", "bakery-backups")
        file_path = Path(backup_path)
        if not file_path.exists():
            return

        # Google Drive
        gdrive_token_raw = cfg.get("cloud_gdrive_token", "")
        if gdrive_token_raw:
            try:
                token = json.loads(gdrive_token_raw)
                _, new_token = cloud_svc.gdrive_upload(
                    _cred(cfg, "cloud_gdrive_client_id",     cloud_svc.DEFAULT_GDRIVE_CLIENT_ID),
                    _cred(cfg, "cloud_gdrive_client_secret", cloud_svc.DEFAULT_GDRIVE_CLIENT_SECRET),
                    token, file_path, folder,
                )
                if new_token != token:
                    _save_setting(db, "cloud_gdrive_token", json.dumps(new_token))
                log.info("Бекап завантажено на Google Drive: %s", file_path.name)
            except Exception as e:
                log.warning("Google Drive upload failed: %s", e)

        # OneDrive
        onedrive_token_raw = cfg.get("cloud_onedrive_token", "")
        if onedrive_token_raw:
            try:
                token = json.loads(onedrive_token_raw)
                _, new_token = cloud_svc.onedrive_upload(
                    _cred(cfg, "cloud_onedrive_client_id", cloud_svc.DEFAULT_ONEDRIVE_CLIENT_ID),
                    token, file_path, folder,
                )
                if new_token != token:
                    _save_setting(db, "cloud_onedrive_token", json.dumps(new_token))
                log.info("Бекап завантажено на OneDrive: %s", file_path.name)
            except Exception as e:
                log.warning("OneDrive upload failed: %s", e)

        # Dropbox
        dropbox_token_raw = cfg.get("cloud_dropbox_token", "")
        if dropbox_token_raw:
            try:
                token = json.loads(dropbox_token_raw)
                _, new_token = cloud_svc.dropbox_upload(
                    _cred(cfg, "cloud_dropbox_app_key",    cloud_svc.DEFAULT_DROPBOX_APP_KEY),
                    _cred(cfg, "cloud_dropbox_app_secret", cloud_svc.DEFAULT_DROPBOX_APP_SECRET),
                    token, file_path, folder,
                )
                if new_token != token:
                    _save_setting(db, "cloud_dropbox_token", json.dumps(new_token))
                log.info("Бекап завантажено на Dropbox: %s", file_path.name)
            except Exception as e:
                log.warning("Dropbox upload failed: %s", e)
    finally:
        db.close()


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
def backup_now(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
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
    # Завантаження в хмари — у фоні, не блокує відповідь
    background_tasks.add_task(_cloud_upload_bg, result["path"])
    return result


# ── Видалити бекап ─────────────────────────────────────────────────────────────

@router.delete("/{filename}")
def delete_backup(filename: str, db: Session = Depends(get_db)):
    cfg = _get_settings(db)
    ok = backup_svc.delete_backup(ROOT, filename, cfg.get("backup_local_dir", ""))
    if not ok:
        raise HTTPException(status_code=404, detail="Бекап не знайдений")
    return {"deleted": filename}


# ── Хмарні провайдери ─────────────────────────────────────────────────────────

_PROVIDER_TOKEN_KEY = {
    "google":   "cloud_gdrive_token",
    "onedrive": "cloud_onedrive_token",
    "dropbox":  "cloud_dropbox_token",
}
_PROVIDER_LABELS = {"google": "Google Drive", "onedrive": "OneDrive", "dropbox": "Dropbox"}


@router.get("/cloud/status")
def cloud_status(db: Session = Depends(get_db)):
    """Статус підключення для кожного хмарного провайдера."""
    cfg = _get_settings(db)
    return {
        p: bool(cfg.get(k))
        for p, k in _PROVIDER_TOKEN_KEY.items()
    }


def _cred(cfg: dict, key: str, default: str) -> str:
    """DB-значення як override, інакше вбудований default."""
    return cfg.get(key, "").strip() or default


@router.get("/cloud/{provider}/connect")
def cloud_connect(provider: str, db: Session = Depends(get_db)):
    """Повертає OAuth URL для авторизації у браузері."""
    if provider not in _PROVIDER_LABELS:
        raise HTTPException(400, "Невідомий провайдер")
    cfg = _get_settings(db)
    if provider == "google":
        cid = _cred(cfg, "cloud_gdrive_client_id", cloud_svc.DEFAULT_GDRIVE_CLIENT_ID)
        if not cid:
            raise HTTPException(400, "Google Drive ще не налаштовано. Зверніться до адміністратора.")
        return {"auth_url": cloud_svc.gdrive_auth_url(cid)}
    if provider == "onedrive":
        cid = _cred(cfg, "cloud_onedrive_client_id", cloud_svc.DEFAULT_ONEDRIVE_CLIENT_ID)
        if not cid:
            raise HTTPException(400, "OneDrive ще не налаштовано. Зверніться до адміністратора.")
        return {"auth_url": cloud_svc.onedrive_auth_url(cid)}
    if provider == "dropbox":
        key = _cred(cfg, "cloud_dropbox_app_key", cloud_svc.DEFAULT_DROPBOX_APP_KEY)
        if not key:
            raise HTTPException(400, "Dropbox ще не налаштовано. Зверніться до адміністратора.")
        return {"auth_url": cloud_svc.dropbox_auth_url(key)}


@router.get("/cloud/callback/{provider}")
def cloud_callback(provider: str, code: str = "", error: str = "",
                   db: Session = Depends(get_db)):
    """OAuth callback. Обмінює code на токен і зберігає в БД."""
    _CLOSE_JS = "<script>if(window.opener){window.opener.postMessage({type:'cloud_auth_success',provider:'%s'},'*');window.close();}else{document.body.innerHTML='<p>Авторизацію виконано. Закрийте цю вкладку.</p>';}</script>"
    if error:
        return HTMLResponse(f"<p>Авторизацію скасовано: {error}</p>")
    if not code:
        return HTMLResponse("<p>Помилка: не отримано код авторизації.</p>")
    cfg = _get_settings(db)
    try:
        if provider == "google":
            token = cloud_svc.gdrive_exchange(
                _cred(cfg, "cloud_gdrive_client_id",     cloud_svc.DEFAULT_GDRIVE_CLIENT_ID),
                _cred(cfg, "cloud_gdrive_client_secret", cloud_svc.DEFAULT_GDRIVE_CLIENT_SECRET), code)
        elif provider == "onedrive":
            token = cloud_svc.onedrive_exchange(
                _cred(cfg, "cloud_onedrive_client_id", cloud_svc.DEFAULT_ONEDRIVE_CLIENT_ID), code)
        elif provider == "dropbox":
            token = cloud_svc.dropbox_exchange(
                _cred(cfg, "cloud_dropbox_app_key",    cloud_svc.DEFAULT_DROPBOX_APP_KEY),
                _cred(cfg, "cloud_dropbox_app_secret", cloud_svc.DEFAULT_DROPBOX_APP_SECRET), code)
        else:
            return HTMLResponse("<p>Невідомий провайдер.</p>")
        _save_setting(db, _PROVIDER_TOKEN_KEY[provider], json.dumps(token))
    except Exception as e:
        return HTMLResponse(f"<p>Помилка авторизації: {e}</p>")
    return HTMLResponse(_CLOSE_JS % provider)


@router.delete("/cloud/{provider}")
def cloud_disconnect(provider: str, db: Session = Depends(get_db)):
    if provider not in _PROVIDER_TOKEN_KEY:
        raise HTTPException(400, "Невідомий провайдер")
    _save_setting(db, _PROVIDER_TOKEN_KEY[provider], "")
    return {"disconnected": provider}


@router.get("/cloud/{provider}/list")
def cloud_list_files(provider: str, db: Session = Depends(get_db)):
    """Список бекапів у хмарі для вибраного провайдера."""
    cfg = _get_settings(db)
    folder = cfg.get("cloud_folder_name", "bakery-backups")
    token_raw = cfg.get(_PROVIDER_TOKEN_KEY.get(provider, ""), "")
    if not token_raw:
        raise HTTPException(400, f"{_PROVIDER_LABELS.get(provider, provider)} не підключено")
    token = json.loads(token_raw)
    try:
        if provider == "google":
            files, new_token = cloud_svc.gdrive_list(
                _cred(cfg, "cloud_gdrive_client_id",     cloud_svc.DEFAULT_GDRIVE_CLIENT_ID),
                _cred(cfg, "cloud_gdrive_client_secret", cloud_svc.DEFAULT_GDRIVE_CLIENT_SECRET),
                token, folder)
        elif provider == "onedrive":
            files, new_token = cloud_svc.onedrive_list(
                _cred(cfg, "cloud_onedrive_client_id", cloud_svc.DEFAULT_ONEDRIVE_CLIENT_ID),
                token, folder)
        elif provider == "dropbox":
            files, new_token = cloud_svc.dropbox_list(
                _cred(cfg, "cloud_dropbox_app_key",    cloud_svc.DEFAULT_DROPBOX_APP_KEY),
                _cred(cfg, "cloud_dropbox_app_secret", cloud_svc.DEFAULT_DROPBOX_APP_SECRET),
                token, folder)
        else:
            raise HTTPException(400, "Невідомий провайдер")
        if new_token != token:
            _save_setting(db, _PROVIDER_TOKEN_KEY[provider], json.dumps(new_token))
        return files
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/cloud/{provider}/download/{file_id:path}")
def cloud_download_file(provider: str, file_id: str, db: Session = Depends(get_db)):
    """Завантажує файл з хмари і повертає клієнту."""
    cfg = _get_settings(db)
    token_raw = cfg.get(_PROVIDER_TOKEN_KEY.get(provider, ""), "")
    if not token_raw:
        raise HTTPException(400, f"{_PROVIDER_LABELS.get(provider, provider)} не підключено")
    token = json.loads(token_raw)
    try:
        if provider == "google":
            content, name, new_token = cloud_svc.gdrive_download(
                _cred(cfg, "cloud_gdrive_client_id",     cloud_svc.DEFAULT_GDRIVE_CLIENT_ID),
                _cred(cfg, "cloud_gdrive_client_secret", cloud_svc.DEFAULT_GDRIVE_CLIENT_SECRET),
                token, file_id)
        elif provider == "onedrive":
            content, name, new_token = cloud_svc.onedrive_download(
                _cred(cfg, "cloud_onedrive_client_id", cloud_svc.DEFAULT_ONEDRIVE_CLIENT_ID),
                token, file_id)
        elif provider == "dropbox":
            content, name, new_token = cloud_svc.dropbox_download(
                _cred(cfg, "cloud_dropbox_app_key",    cloud_svc.DEFAULT_DROPBOX_APP_KEY),
                _cred(cfg, "cloud_dropbox_app_secret", cloud_svc.DEFAULT_DROPBOX_APP_SECRET),
                token, file_id)
        else:
            raise HTTPException(400, "Невідомий провайдер")
        if new_token != token:
            _save_setting(db, _PROVIDER_TOKEN_KEY[provider], json.dumps(new_token))
        return Response(
            content=content,
            media_type="application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{name}"'},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Завантажити файл бекапу (SaveFile) ────────────────────────────────────────

@router.get("/download/{filename}")
def download_backup(filename: str, db: Session = Depends(get_db)):
    """Повертає файл бекапу для збереження користувачем."""
    cfg = _get_settings(db)
    backup_dir = backup_svc._backup_dir(ROOT, cfg.get("backup_local_dir", ""))
    path = backup_dir / filename
    if not path.exists() or not path.name.startswith("bakery_") or path.suffix != ".db":
        raise HTTPException(status_code=404, detail="Бекап не знайдений")
    return FileResponse(
        path=str(path),
        media_type="application/octet-stream",
        filename=filename,
    )


# ── Імпортувати файл бекапу (OpenFile) ─────────────────────────────────────────

@router.post("/upload")
async def upload_backup(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Приймає .db файл і зберігає його в папку бекапів."""
    if not file.filename or not file.filename.endswith(".db"):
        raise HTTPException(status_code=400, detail="Файл має мати розширення .db")
    cfg = _get_settings(db)
    backup_dir = backup_svc._backup_dir(ROOT, cfg.get("backup_local_dir", ""))
    backup_dir.mkdir(parents=True, exist_ok=True)

    # Безпечна назва файлу — лишаємо тільки допустимі символи
    import re
    safe_name = re.sub(r"[^\w.\-]", "_", file.filename)
    dest = backup_dir / safe_name
    content = await file.read()
    dest.write_bytes(content)

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
