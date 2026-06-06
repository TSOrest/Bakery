"""Ендпоінти для груп клієнтів у межах маршруту.

Група служить для друкованої форми "Сортування" — оператор бачить
вироби, агреговані по групах у межах рейсу, для зручного завантаження машини.

Cascade-правила:
- Видалення маршруту → видалення всіх його груп (ON DELETE CASCADE) →
  у клієнтів client_group_id стає NULL (через ON DELETE SET NULL у FK).
- Видалення групи → клієнти лишаються без групи (client_group_id = NULL).
- При зміні route_id у клієнта (PUT /clients/{id}) — якщо у нього був
  client_group_id посилається на групу старого маршруту → скидаємо у NULL.
  Це робиться у routers/clients.py.
"""
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.database import get_db, safe_commit
from backend.models.references import Client, ClientGroup, Route
from backend.schemas.references import (
    ClientGroupCreate, ClientGroupUpdate, ClientGroupOut,
)
from backend.routers.auth import require_user, require_admin


router = APIRouter(prefix="/client-groups", tags=["Групи клієнтів"])


def _enrich(g: ClientGroup, member_count: int) -> ClientGroupOut:
    out = ClientGroupOut.model_validate(g)
    out.member_count = member_count
    return out


def _counts_for(group_ids: List[int], db: Session) -> dict[int, int]:
    if not group_ids:
        return {}
    rows = (
        db.query(Client.client_group_id, func.count(Client.id))
        .filter(Client.client_group_id.in_(group_ids), Client.is_active == 1)
        .group_by(Client.client_group_id)
        .all()
    )
    return {gid: cnt for gid, cnt in rows}


@router.get("/", response_model=List[ClientGroupOut])
def list_client_groups(
    route_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Список груп. Якщо route_id задано — фільтр за маршрутом."""
    q = db.query(ClientGroup)
    if route_id is not None:
        q = q.filter(ClientGroup.route_id == route_id)
    groups = q.order_by(ClientGroup.route_id, ClientGroup.sort_order, ClientGroup.name).all()
    counts = _counts_for([g.id for g in groups], db)
    return [_enrich(g, counts.get(g.id, 0)) for g in groups]


@router.post("/", response_model=ClientGroupOut, status_code=201)
def create_client_group(
    data: ClientGroupCreate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    if not db.get(Route, data.route_id):
        raise HTTPException(status_code=404, detail="Маршрут не знайдено")
    g = ClientGroup(
        name=data.name.strip(),
        route_id=data.route_id,
        sort_order=data.sort_order,
        created_at=datetime.now().isoformat(),
    )
    db.add(g)
    safe_commit(db, conflict_msg="Група з такою назвою вже існує")
    db.refresh(g)
    return _enrich(g, 0)


@router.put("/{group_id}", response_model=ClientGroupOut)
def update_client_group(
    group_id: int,
    data: ClientGroupUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    g = db.get(ClientGroup, group_id)
    if not g:
        raise HTTPException(status_code=404, detail="Групу не знайдено")
    patch = data.model_dump(exclude_none=True)
    if "name" in patch:
        patch["name"] = patch["name"].strip()
    for field, value in patch.items():
        setattr(g, field, value)
    safe_commit(db, conflict_msg="Група з такою назвою вже існує")
    db.refresh(g)
    cnt = _counts_for([g.id], db).get(g.id, 0)
    return _enrich(g, cnt)


@router.delete("/{group_id}", status_code=204)
def delete_client_group(
    group_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    g = db.get(ClientGroup, group_id)
    if not g:
        raise HTTPException(status_code=404, detail="Групу не знайдено")
    # SQLite не виконує ON DELETE SET NULL без PRAGMA foreign_keys=ON.
    # Скидаємо членство вручну для гарантії.
    (
        db.query(Client)
        .filter(Client.client_group_id == group_id)
        .update({Client.client_group_id: None})
    )
    db.delete(g)
    safe_commit(db)


@router.get("/{group_id}/members", response_model=List[int])
def list_group_members(group_id: int, db: Session = Depends(get_db)):
    """ID клієнтів які зараз входять у групу (активні + неактивні)."""
    rows = (
        db.query(Client.id)
        .filter(Client.client_group_id == group_id)
        .all()
    )
    return [r[0] for r in rows]


@router.put("/{group_id}/members", response_model=List[int])
def set_group_members(
    group_id: int,
    client_ids: List[int],
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Замінити набір клієнтів групи. Валідація:
    - усі client_ids мають належати тому самому маршруту що й група;
    - решта клієнтів цього group_id (не у новому списку) звільняється (NULL).
    """
    g = db.get(ClientGroup, group_id)
    if not g:
        raise HTTPException(status_code=404, detail="Групу не знайдено")

    if client_ids:
        bad = (
            db.query(Client.id)
            .filter(
                Client.id.in_(client_ids),
                (Client.route_id != g.route_id) | (Client.route_id.is_(None)),
            )
            .all()
        )
        if bad:
            raise HTTPException(
                status_code=400,
                detail=f"Клієнти {[b[0] for b in bad]} не належать маршруту групи",
            )

    # 1) Звільняємо тих що зараз у групі але не у новому списку.
    q = db.query(Client).filter(Client.client_group_id == group_id)
    if client_ids:
        q = q.filter(~Client.id.in_(client_ids))
    q.update({Client.client_group_id: None}, synchronize_session=False)

    # 2) Призначаємо нових.
    if client_ids:
        (
            db.query(Client)
            .filter(Client.id.in_(client_ids))
            .update({Client.client_group_id: group_id}, synchronize_session=False)
        )

    safe_commit(db)
    return client_ids
