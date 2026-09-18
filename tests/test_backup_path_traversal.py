"""Регрес-тест на "середню" знахідку QA-аудиту: ім'я файлу бекапу не
перевірялось на вихід за межі папки бекапів (backend/services/backup.py:
delete_backup, get_backup_meta, restore_backup; backend/routers/backup.py:
download_backup, restore_backup). "../../../file" могло вказати поза
backup_dir. Виправлено: filename нормалізується через Path(filename).name
(голе ім'я файлу) перед побудовою шляху в усіх п'яти місцях.
"""

import tempfile
from pathlib import Path

from backend.services import backup as backup_svc


def test_delete_backup_cannot_escape_directory(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    outside = tmp_path / "secret.db"
    outside.write_text("не чіпати")

    ok = backup_svc.delete_backup(root, "../secret.db")
    assert ok is False
    assert outside.exists(), "файл поза папкою бекапів не мав постраждати"


def test_get_backup_meta_cannot_escape_directory(tmp_path):
    root = tmp_path / "root2"
    root.mkdir()
    outside_meta = tmp_path / "secret.meta.json"
    outside_meta.write_text('{"app_version": "v9.9.9"}', encoding="utf-8")

    meta = backup_svc.get_backup_meta(root, "../secret.db")
    assert meta == {}, "не мало прочитати metadata поза папкою бекапів"


def test_restore_backup_cannot_escape_directory(tmp_path):
    root = tmp_path / "root3"
    root.mkdir()

    try:
        backup_svc.restore_backup(root, tmp_path / "bakery.db", "../../windows/system32/whatever.db")
    except FileNotFoundError as exc:
        # Очікувано: файл не знайдено ВСЕРЕДИНІ backup_dir (санітизоване
        # ім'я — "whatever.db" всередині root3/backups, а не поза нею).
        assert "system32" not in str(exc)
        return
    raise AssertionError("мало кинути FileNotFoundError у межах backup_dir")
