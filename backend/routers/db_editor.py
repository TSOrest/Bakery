"""
Редактор бази даних — тільки для ролі admin.
Дозволяє переглядати схему таблиць та редагувати дані напряму через SQLite PRAGMA.
"""
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Body
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.routers.auth import get_current_user

router = APIRouter(prefix="/db-editor", tags=["db-editor"])


# ── Auth ────────────────────────────────────────────────────────────────────

def _require_admin(user=Depends(get_current_user)):
    if not user or user.role != "admin":
        raise HTTPException(403, "Доступ лише для адміністратора")
    return user


# ── Helpers ─────────────────────────────────────────────────────────────────

def _validate_table(db: Session, table: str) -> None:
    exists = db.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name=:n"),
        {"n": table}
    ).fetchone()
    if not exists:
        raise HTTPException(404, f"Таблиця '{table}' не знайдена")


def _get_pk_col(db: Session, table: str) -> Optional[str]:
    cols = db.execute(text(f'PRAGMA table_info("{table}")')).fetchall()
    return next((c[1] for c in cols if c[5] > 0), None)


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/tables")
def list_tables(db: Session = Depends(get_db), _=Depends(_require_admin)):
    """Список всіх таблиць з кількістю рядків."""
    rows = db.execute(text(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )).fetchall()
    result = []
    for (name,) in rows:
        count = db.execute(text(f'SELECT COUNT(*) FROM "{name}"')).scalar()
        result.append({"name": name, "row_count": count})
    return result


@router.get("/tables/{table}/schema")
def get_table_schema(
    table: str,
    db: Session = Depends(get_db),
    _=Depends(_require_admin)
):
    """Схема таблиці: колонки, типи, FK, індекси, DDL."""
    _validate_table(db, table)

    cols = db.execute(text(f'PRAGMA table_info("{table}")')).fetchall()
    columns = [
        {
            "cid": c[0],
            "name": c[1],
            "type": c[2] or "TEXT",
            "not_null": bool(c[3]),
            "default": c[4],
            "is_pk": c[5] > 0,
        }
        for c in cols
    ]

    fks = db.execute(text(f'PRAGMA foreign_key_list("{table}")')).fetchall()
    foreign_keys = [
        {
            "from_col": fk[3],
            "to_table": fk[2],
            "to_col": fk[4],
            "on_update": fk[5],
            "on_delete": fk[6],
        }
        for fk in fks
    ]

    idx_list = db.execute(text(f'PRAGMA index_list("{table}")')).fetchall()
    indexes = []
    for idx in idx_list:
        idx_info = db.execute(text(f'PRAGMA index_info("{idx[1]}")')).fetchall()
        indexes.append({
            "name": idx[1],
            "unique": bool(idx[2]),
            "columns": [i[2] for i in idx_info],
        })

    ddl = db.execute(
        text("SELECT sql FROM sqlite_master WHERE type='table' AND name=:n"),
        {"n": table}
    ).scalar()

    return {
        "table": table,
        "columns": columns,
        "foreign_keys": foreign_keys,
        "indexes": indexes,
        "ddl": ddl or "",
    }


@router.get("/tables/{table}/data")
def get_table_data(
    table: str,
    page: int = Query(0, ge=0),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _=Depends(_require_admin),
):
    """Дані таблиці з пагінацією."""
    _validate_table(db, table)

    total = db.execute(text(f'SELECT COUNT(*) FROM "{table}"')).scalar()
    rows = db.execute(
        text(f'SELECT * FROM "{table}" LIMIT :limit OFFSET :offset'),
        {"limit": page_size, "offset": page * page_size},
    ).fetchall()

    cols = db.execute(text(f'PRAGMA table_info("{table}")')).fetchall()
    col_names = [c[1] for c in cols]

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "columns": col_names,
        "rows": [dict(zip(col_names, r)) for r in rows],
    }


@router.get("/tables/{table}/fk-options/{column}")
def get_fk_options(
    table: str,
    column: str,
    db: Session = Depends(get_db),
    _=Depends(_require_admin),
):
    """Опції для dropdown FK поля — список значень з referenced таблиці."""
    _validate_table(db, table)

    fks = db.execute(text(f'PRAGMA foreign_key_list("{table}")')).fetchall()
    fk = next((f for f in fks if f[3] == column), None)
    if not fk:
        raise HTTPException(404, "FK не знайдено для цієї колонки")

    ref_table = fk[2]
    ref_col = fk[4]

    ref_cols = db.execute(text(f'PRAGMA table_info("{ref_table}")')).fetchall()
    ref_col_names = [c[1] for c in ref_cols]

    LABEL_CANDIDATES = ["name", "full_name", "short_name", "title", "key", "description", "value"]
    label_col = next(
        (c for c in LABEL_CANDIDATES if c in ref_col_names),
        ref_col_names[1] if len(ref_col_names) > 1 else ref_col,
    )

    rows = db.execute(
        text(f'SELECT "{ref_col}", "{label_col}" FROM "{ref_table}" ORDER BY "{label_col}"')
    ).fetchall()

    return {
        "ref_table": ref_table,
        "ref_col": ref_col,
        "label_col": label_col,
        "options": [
            {"value": r[0], "label": str(r[1]) if r[1] is not None else f"#{r[0]}"}
            for r in rows
        ],
    }


@router.put("/tables/{table}/row/{pk_value}")
def update_row(
    table: str,
    pk_value: str,
    body: dict = Body(...),
    db: Session = Depends(get_db),
    _=Depends(_require_admin),
):
    """Оновити рядок таблиці за PK."""
    _validate_table(db, table)
    pk_col = _get_pk_col(db, table)
    if not pk_col:
        raise HTTPException(400, "Таблиця без PRIMARY KEY")

    update_data = {k: v for k, v in body.items() if k != pk_col}
    if not update_data:
        return {"ok": True}

    set_clause = ", ".join(f'"{k}" = :p_{k}' for k in update_data)
    params = {f"p_{k}": v for k, v in update_data.items()}
    params["pk_val"] = pk_value

    try:
        db.execute(
            text(f'UPDATE "{table}" SET {set_clause} WHERE "{pk_col}" = :pk_val'),
            params,
        )
        db.commit()
    except Exception as e:
        raise HTTPException(400, f"Помилка оновлення: {e}")

    return {"ok": True}


@router.delete("/tables/{table}/row/{pk_value}")
def delete_row(
    table: str,
    pk_value: str,
    db: Session = Depends(get_db),
    _=Depends(_require_admin),
):
    """Видалити рядок таблиці за PK."""
    _validate_table(db, table)
    pk_col = _get_pk_col(db, table)
    if not pk_col:
        raise HTTPException(400, "Таблиця без PRIMARY KEY")

    try:
        db.execute(
            text(f'DELETE FROM "{table}" WHERE "{pk_col}" = :pk'),
            {"pk": pk_value},
        )
        db.commit()
    except Exception as e:
        raise HTTPException(400, f"Помилка видалення (можливо, порушення FK): {e}")

    return {"ok": True}
