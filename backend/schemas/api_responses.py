"""Спільні Pydantic-моделі для типових API-відповідей.

Підвищує якість OpenAPI документації (/docs) — endpoint-и
що раніше повертали `dict` тепер мають чітку структуру відповіді.
"""
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


# ─── Прості статусні відповіді ────────────────────────────────────────────────


class Ok(BaseModel):
    """Стандартна успішна відповідь без додаткових даних."""
    ok: bool = Field(default=True, example=True)


class StatusDetail(BaseModel):
    """Відповідь з кодом статусу і людським повідомленням.

    Використовується для health-check ендпоінтів (cloud/test, demo/status).
    """
    status: str = Field(..., example="ok")
    detail: Optional[str] = Field(None, example="Папка доступна для запису")


class FilenameMessage(BaseModel):
    """Відповідь після операції з файлом."""
    ok: bool = Field(default=True)
    filename: str = Field(..., example="bakery_20260513-143022.db")
    message: Optional[str] = None


# ─── Бекап ────────────────────────────────────────────────────────────────────


class BackupMetadata(BaseModel):
    """Метадані одного файлу бекапу."""
    name: str = Field(..., example="bakery_20260513-143022.db")
    size_mb: float = Field(..., example=42.7)
    created_at: str = Field(..., example="2026-05-13T14:30:22")
    version: Optional[str] = Field(None, example="v1.0.4")


class BackupNowResult(BaseModel):
    """Результат POST /backup/now."""
    ok: bool = Field(default=True)
    filename: str = Field(..., example="bakery_20260513-143022.db")
    size_mb: float = Field(..., example=42.7)
    cloud_synced: List[str] = Field(default_factory=list, example=["/path/to/google-drive"])


class CloudFolders(BaseModel):
    """Автоматично виявлені папки cloud-провайдерів."""
    google: Optional[str] = Field(None, example="C:\\Users\\User\\Google Drive")
    onedrive: Optional[str] = Field(None, example="C:\\Users\\User\\OneDrive")
    dropbox: Optional[str] = Field(None, example="C:\\Users\\User\\Dropbox")


class RestoreCheckResult(BaseModel):
    """Перевірка сумісності бекапу для відновлення."""
    compatible: bool = Field(..., example=True)
    backup_version: Optional[str] = Field(None, example="v1.0.3")
    current_version: str = Field(..., example="v1.0.4")
    rollback_available: bool = Field(default=False)
    warning: Optional[str] = None


class DemoStatus(BaseModel):
    """Стан демо-режиму."""
    active: bool = Field(..., example=False)
    since: Optional[str] = Field(
        None, example="2026-05-13T14:30:22",
        description="ISO datetime коли увімкнено демо-режим",
    )
    demo_db_exists: bool = Field(..., example=True)


class DemoActionResult(BaseModel):
    """Результат POST /demo/enter або /demo/exit."""
    status: str = Field(..., example="requested")


class RestoreRequest(BaseModel):
    """Результат POST /restore/{filename}."""
    status: str = Field(..., example="requested")
    filename: str
    rollback_first: bool = Field(default=False)


class UploadBackupResult(BaseModel):
    """Результат POST /upload."""
    filename: str = Field(..., example="bakery_20260513-143022.db")
    size_kb: float = Field(..., example=2456.7)


class DeleteResult(BaseModel):
    """Стандартна відповідь видалення."""
    deleted: str = Field(..., example="bakery_20260513-143022.db")


class ArchivePreview(BaseModel):
    """Попередній перегляд кількості записів які буде видалено."""
    cutoff_date: str = Field(..., example="2026-01-01")
    counts: Dict[str, int] = Field(
        default_factory=dict,
        example={"orders": 1234, "invoices": 456, "finances": 789},
    )
    db_size_mb: float = Field(..., example=125.4)
    estimated_freed_mb: float = Field(..., example=42.8)


class ArchiveResult(BaseModel):
    """Результат архівування."""
    ok: bool = Field(default=True)
    cutoff_date: str = Field(..., example="2026-01-01")
    deleted: Dict[str, int] = Field(default_factory=dict)
    deleted_rows: int = Field(..., example=2497)
    freed_mb: float = Field(..., example=42.8)


# ─── Telegram bot ─────────────────────────────────────────────────────────────


class BotOrderPending(BaseModel):
    """Bot-замовлення в очікуванні верифікації оператором."""
    id: int = Field(..., example=12345)
    client_id: int = Field(..., example=42)
    client_name: str = Field(..., example="Магазин «Зоря»")
    product_id: int = Field(..., example=7)
    product_name: str = Field(..., example="Хліб Карпатський")
    qty: float = Field(..., example=10)
    price: float = Field(..., example=25.0)
    sum: float = Field(..., example=250.0)
    order_date: str = Field(..., example="2026-05-14")


class BotOrderStatus(BaseModel):
    """Поточний стан прийому замовлень ботом."""
    accepting: bool = Field(..., example=True)
    closed_until: Optional[str] = Field(
        None, example="2026-05-14T08:00:00",
        description="ISO datetime коли прийом відновиться (NULL якщо приймає)",
    )
    bot_running: Optional[bool] = Field(
        None, description="Чи запущений Telegram-бот (тільки у /order-status)",
    )


class BotVerifyResult(BaseModel):
    """Результат верифікації pending-замовлення."""
    ok: bool = Field(default=True)
    status: Optional[str] = Field(
        None, example="confirmed",
        description="Новий bot_status: confirmed | rejected | modified",
    )


class BotBroadcastResult(BaseModel):
    """Результат розсилки нагадування/закриття."""
    sent: int = Field(..., example=15, description="Скільки повідомлень надіслано")
    skipped: int = Field(default=0, description="Скільки клієнтів пропущено (нема chat_id)")


class BotUserInfo(BaseModel):
    """Авторизований Telegram-користувач клієнта."""
    id: int
    chat_id: str
    phone: Optional[str] = None
    first_name: Optional[str] = None
    authorized_at: Optional[str] = None
    is_active: int = Field(default=1)


# ─── Import .accdb ────────────────────────────────────────────────────────────


class AccdbDbStatus(BaseModel):
    """Стан БД для воркфлоу імпорту. Якщо total > 0 — БД потребує скидання."""
    total: int = Field(..., example=0)
    counts: Dict[str, int] = Field(
        default_factory=dict,
        example={"clients": 0, "products": 0, "orders": 0},
    )


class AccdbDriverCheck(BaseModel):
    """Перевірка доступності Access ODBC Driver."""
    ok: bool = Field(..., example=True)
    error: Optional[str] = Field(None, example=None)


class AccdbImportStatus(BaseModel):
    """Поточний прогрес імпорту (polling endpoint)."""
    running: bool = Field(..., example=True)
    step: str = Field(default="", example="Імпорт замовлень")
    progress: int = Field(..., example=45, description="0-100")
    error: Optional[str] = None


class AccdbImportStart(BaseModel):
    """Підтвердження запуску імпорту."""
    status: str = Field(..., example="started")


# ─── Дашборд (мінімально-типізовані) ──────────────────────────────────────────


class DashboardCalendar(BaseModel):
    """Місячний календар для дашборду."""
    year: int = Field(..., example=2026)
    month: int = Field(..., example=5, ge=1, le=12)
    days: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Список днів з агрегованими даними",
    )
