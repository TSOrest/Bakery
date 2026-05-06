"""Сервіс резервного копіювання БД."""
import json
import logging
import shutil
import sqlite3
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)


def _backup_dir(root: Path, custom_dir: str) -> Path:
    """Повертає папку для бекапів. Якщо custom_dir порожній — використовує root/backups/."""
    d = Path(custom_dir) if custom_dir.strip() else root / "backups"
    d.mkdir(parents=True, exist_ok=True)
    return d


def do_backup(
    db_path: Path,
    root: Path,
    custom_dir: str = "",
    keep_count: int = 7,
    cloud_paths: Optional[list] = None,
    app_version: str = "",
    max_disk_mb: int = 0,
) -> dict:
    """
    Робить SQLite online backup → датований файл + sidecar .meta.json.
    Повертає {name, path, size_kb, app_version, created_at}.
    """
    if not db_path.exists():
        raise FileNotFoundError(f"БД не знайдена: {db_path}")

    backup_dir = _backup_dir(root, custom_dir)
    ts = time.strftime("%Y-%m-%d_%H-%M")
    name = f"bakery_{ts}.db"
    dst = backup_dir / name
    meta_dst = backup_dir / f"bakery_{ts}.meta.json"
    created_at = datetime.now().isoformat(timespec="seconds")

    # SQLite online backup API — безпечно при активних з'єднаннях
    src_con = sqlite3.connect(str(db_path))
    dst_con = sqlite3.connect(str(dst))
    with dst_con:
        src_con.backup(dst_con)
    dst_con.close()
    src_con.close()

    # Sidecar метаданих
    meta = {"app_version": app_version, "created_at": created_at}
    meta_dst.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")

    size_kb = round(dst.stat().st_size / 1024, 1)

    # Копіювання в хмарні папки
    if cloud_paths:
        for cp in cloud_paths:
            cp = cp.strip()
            if not cp:
                continue
            try:
                cloud_dir = Path(cp)
                cloud_dir.mkdir(parents=True, exist_ok=True)
                shutil.copy2(dst, cloud_dir / name)
                shutil.copy2(meta_dst, cloud_dir / meta_dst.name)
            except Exception as exc:
                log.warning("Cloud backup copy to %s failed: %s", cp, exc)

    # Ротація: за кількістю + за розміром (захист від накопичення гігабайт)
    rotate(backup_dir, keep_count, max_disk_mb)

    return {"name": name, "path": str(dst), "size_kb": size_kb,
            "app_version": app_version, "created_at": created_at}


def list_backups(root: Path, custom_dir: str = "") -> list:
    """
    Повертає список бекапів [{name, size_kb, created_at, app_version}]
    відсортований від новіших до старіших.
    """
    backup_dir = _backup_dir(root, custom_dir)
    results = []
    for f in sorted(backup_dir.glob("bakery_*.db"), reverse=True):
        meta_file = f.with_suffix(".meta.json")
        app_version = ""
        created_at = ""
        if meta_file.exists():
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
                app_version = meta.get("app_version", "").lstrip("\ufeff")
                created_at = meta.get("created_at", "")
            except Exception as exc:
                log.warning("Failed to parse backup meta %s: %s", meta_file, exc)
        if not created_at:
            # Fallback: з mtime файлу
            created_at = datetime.fromtimestamp(f.stat().st_mtime).isoformat(timespec="seconds")
        results.append({
            "name": f.name,
            "size_kb": round(f.stat().st_size / 1024, 1),
            "created_at": created_at,
            "app_version": app_version,
        })
    return results


def rotate(backup_dir: Path, keep_count: int, max_disk_mb: int = 0) -> int:
    """
    Ротація бекапів за двома критеріями:
    1. keep_count — залишити N найновіших (старі видалити)
    2. max_disk_mb — якщо сумарний розмір > ліміту, видаляти найстаріші
       з лишку поки не вкладеться. Захист від накопичення великих БД.
       0 або негативне значення = без перевірки розміру.

    Видаляє і .db і .meta.json разом.
    Повертає кількість видалених файлів.
    """
    if keep_count <= 0:
        return 0
    files = sorted(backup_dir.glob("bakery_*.db"), reverse=True)
    deleted = 0

    def _delete_one(path: Path) -> None:
        nonlocal deleted
        try:
            path.unlink()
            deleted += 1
        except Exception as exc:
            log.warning("Failed to delete old backup %s: %s", path, exc)
        meta = path.with_suffix(".meta.json")
        if meta.exists():
            try:
                meta.unlink()
            except Exception as exc:
                log.warning("Failed to delete backup meta %s: %s", meta, exc)

    # 1. За кількістю
    for old in files[keep_count:]:
        _delete_one(old)

    # 2. За розміром — серед тих що лишились (першi keep_count)
    if max_disk_mb > 0:
        max_bytes = max_disk_mb * 1024 * 1024
        remaining = sorted(backup_dir.glob("bakery_*.db"), reverse=True)
        total = sum(f.stat().st_size for f in remaining if f.exists())
        # Видаляємо найстаріші (з кінця) поки не вкладемось у ліміт.
        # Найновіший залишаємо завжди — це остання можливість відновлення.
        idx = len(remaining) - 1
        while total > max_bytes and idx > 0:
            old = remaining[idx]
            if old.exists():
                size = old.stat().st_size
                _delete_one(old)
                total -= size
            idx -= 1

    return deleted


def delete_backup(root: Path, filename: str, custom_dir: str = "") -> bool:
    """Видаляє бекап по імені файлу (і .db і .meta.json). Повертає True якщо успішно."""
    backup_dir = _backup_dir(root, custom_dir)
    db_file = backup_dir / filename
    if not db_file.exists():
        return False
    db_file.unlink()
    meta = db_file.with_suffix(".meta.json")
    if meta.exists():
        meta.unlink()
    return True


def get_backup_meta(root: Path, filename: str, custom_dir: str = "") -> dict:
    """Повертає метадані бекапу {app_version, created_at} або {}."""
    backup_dir = _backup_dir(root, custom_dir)
    meta_file = (backup_dir / filename).with_suffix(".meta.json")
    if not meta_file.exists():
        return {}
    try:
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
        if "app_version" in meta:
            meta["app_version"] = meta["app_version"].lstrip("\ufeff")
        return meta
    except Exception as exc:
        log.warning("Failed to read backup meta %s: %s", meta_file, exc)
        return {}


def restore_backup(root: Path, db_path: Path, filename: str, custom_dir: str = "") -> None:
    """
    Відновлює бекап через SQLite backup API (не raw copy).
    Правильно обробляє WAL-режим і гарантує чистий checkpoint.
    УВАГА: викликати тільки коли сервер зупинений.
    """
    backup_dir = _backup_dir(root, custom_dir)
    src = backup_dir / filename
    if not src.exists():
        raise FileNotFoundError(f"Бекап не знайдений: {src}")
    # Видаляємо старий WAL/SHM щоб не було конфлікту
    for ext in ("-wal", "-shm"):
        p = Path(str(db_path) + ext)
        if p.exists():
            p.unlink(missing_ok=True)
    # SQLite backup API — правильно checkpoint-ує WAL в source
    src_con = sqlite3.connect(str(src))
    dst_con = sqlite3.connect(str(db_path))
    src_con.backup(dst_con)
    dst_con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    dst_con.close()
    src_con.close()
