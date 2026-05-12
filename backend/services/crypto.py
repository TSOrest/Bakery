"""Шифрування чутливих налаштувань (OAuth-токени тощо) через Fernet.

Ключ генерується одноразово при першому використанні і зберігається
у `BAKERY_DATA_DIR/.fernet_key`. Файл доступний лише адміністратору
машини (через права Windows на ProgramData/Bakery).

Формат зашифрованого значення: `enc:<urlsafe-base64>`. Старі (plain)
значення без префіксу `enc:` залишаються читабельними — це забезпечує
backward compatibility і ледачу міграцію (lazy reencrypt при наступному
збереженні).

Використання:
    from backend.services.crypto import encrypt_setting, decrypt_setting
    safe = encrypt_setting("my-secret-token")
    plain = decrypt_setting(safe)
"""

from __future__ import annotations

import logging
import os
import secrets
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

log = logging.getLogger(__name__)

ENC_PREFIX = "enc:"
KEY_FILENAME = ".fernet_key"


def _data_dir() -> Path:
    """BAKERY_DATA_DIR з env або проектна root як fallback."""
    data_dir = os.environ.get("BAKERY_DATA_DIR")
    if data_dir:
        return Path(data_dir)
    # Fallback на root проекту (для dev)
    return Path(__file__).parent.parent.parent


def _key_path() -> Path:
    return _data_dir() / KEY_FILENAME


_fernet_cache: Optional[Fernet] = None


def _get_fernet() -> Fernet:
    """Повертає Fernet, генерує ключ при першому виклику."""
    global _fernet_cache
    if _fernet_cache is not None:
        return _fernet_cache

    key_file = _key_path()
    if key_file.exists():
        key = key_file.read_bytes().strip()
    else:
        # Генеруємо новий ключ і зберігаємо
        key = Fernet.generate_key()
        try:
            key_file.parent.mkdir(parents=True, exist_ok=True)
            key_file.write_bytes(key)
            # На Windows немає chmod, тому покладаємось на NTFS-permissions
            # успадковані з C:\ProgramData\Bakery (адмін-only).
            log.info("Згенеровано новий Fernet-ключ: %s", key_file)
        except OSError as exc:
            log.error("Не вдалось зберегти Fernet-ключ у %s: %s", key_file, exc)
            raise

    _fernet_cache = Fernet(key)
    return _fernet_cache


def is_encrypted(value: Optional[str]) -> bool:
    """True якщо значення вже у форматі `enc:...`."""
    return bool(value and value.startswith(ENC_PREFIX))


def encrypt_setting(value: str) -> str:
    """Шифрує plain-значення → 'enc:<base64>'.

    Якщо value вже зашифроване — повертає як є.
    Порожнє значення повертається без змін (нема сенсу шифрувати "").
    """
    if not value:
        return value
    if is_encrypted(value):
        return value
    f = _get_fernet()
    token = f.encrypt(value.encode("utf-8")).decode("ascii")
    return ENC_PREFIX + token


def decrypt_setting(value: Optional[str]) -> str:
    """Розшифровує 'enc:<base64>' → plain.

    Якщо без префіксу `enc:` — повертає як є (legacy plain value або порожнє).
    При помилці розшифрування — повертає порожній рядок з логуванням
    (щоб не падали ендпоінти при пошкодженому token-і / зміненому ключі).
    """
    if not value:
        return ""
    if not is_encrypted(value):
        return value
    try:
        f = _get_fernet()
        plain = f.decrypt(value[len(ENC_PREFIX):].encode("ascii"))
        return plain.decode("utf-8")
    except InvalidToken:
        log.warning(
            "Не вдалось розшифрувати setting (InvalidToken) — можливо ключ "
            "було замінено. Поверніться до OAuth-авторизації."
        )
        return ""
    except Exception:
        log.exception("Несподівана помилка при decrypt_setting")
        return ""


def rotate_key() -> None:
    """
    Викидає поточний ключ з кешу — наступний _get_fernet() перечитає з диску.

    Використовується для тестів або після ручної заміни ключа адміністратором.
    Старі зашифровані значення стануть нерозшифровуваними — їх треба буде
    перезаписати plain через OAuth-авторизацію наново.
    """
    global _fernet_cache
    _fernet_cache = None
