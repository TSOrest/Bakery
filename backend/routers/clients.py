"""Ендпоінти для клієнтів."""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.database import get_db, safe_commit
from backend.models.references import Client
from backend.schemas.references import ClientCreate, ClientUpdate, ClientOut
from backend.routers.auth import require_admin

router = APIRouter(prefix="/clients", tags=["Клієнти"])


@router.get("/", response_model=List[ClientOut])
def list_clients(
    route_id: Optional[int] = None,
    active_only: bool = True,
    db: Session = Depends(get_db),
):
    q = db.query(Client)
    if active_only:
        q = q.filter(Client.is_active == 1)
    if route_id is not None:
        q = q.filter(Client.route_id == route_id)
    return q.order_by(Client.full_name).all()


@router.get("/{client_id}", response_model=ClientOut)
def get_client(client_id: int, db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c:
        raise HTTPException(status_code=404, detail="Клієнта не знайдено")
    return c


@router.post("/", response_model=ClientOut, status_code=201)
def create_client(data: ClientCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    from datetime import datetime
    c = Client(**data.model_dump(), created_at=datetime.now().isoformat())
    db.add(c)
    safe_commit(db, conflict_msg="Клієнт із такими даними вже існує")
    db.refresh(c)
    return c


@router.put("/{client_id}", response_model=ClientOut)
def update_client(client_id: int, data: ClientUpdate, db: Session = Depends(get_db), _=Depends(require_admin)):
    from backend.models.references import ClientGroup
    c = db.get(Client, client_id)
    if not c:
        raise HTTPException(status_code=404, detail="Клієнта не знайдено")
    patch = data.model_dump(exclude_none=True)
    for field, value in patch.items():
        setattr(c, field, value)
    # Cascade: якщо змінили маршрут — група старого маршруту вже не валідна.
    # Перевіряємо актуальну групу клієнта (після setattr) на відповідність route_id.
    if c.client_group_id is not None:
        g = db.get(ClientGroup, c.client_group_id)
        if g is None or g.route_id != c.route_id:
            c.client_group_id = None
    safe_commit(db, conflict_msg="Клієнт із такими даними вже існує")
    db.refresh(c)
    return c


@router.delete("/{client_id}", status_code=204)
def deactivate_client(client_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    c = db.get(Client, client_id)
    if not c:
        raise HTTPException(status_code=404, detail="Клієнта не знайдено")
    c.is_active = 0
    safe_commit(db)
