"""Ендпоінти для маршрутів."""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from backend.database import get_db, safe_commit
from backend.models.references import Client, Route
from backend.schemas.references import RouteCreate, RouteOut
from backend.routers.auth import require_user, require_admin

router = APIRouter(prefix="/routes", tags=["Маршрути"])


@router.get("/", response_model=List[RouteOut])
def list_routes(active_only: bool = True, db: Session = Depends(get_db)):
    q = db.query(Route)
    if active_only:
        q = q.filter(Route.is_active == 1)
    return q.order_by(Route.sort_order, Route.name).all()


@router.post("/", response_model=RouteOut, status_code=201)
def create_route(data: RouteCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    r = Route(**data.model_dump())
    db.add(r)
    safe_commit(db, conflict_msg="Маршрут із такою назвою вже існує")
    db.refresh(r)
    return r


@router.put("/{route_id}", response_model=RouteOut)
def update_route(route_id: int, data: RouteCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    r = db.get(Route, route_id)
    if not r:
        raise HTTPException(status_code=404, detail="Маршрут не знайдено")
    for field, value in data.model_dump().items():
        setattr(r, field, value)
    safe_commit(db, conflict_msg="Маршрут із такою назвою вже існує")
    db.refresh(r)
    return r


@router.get("/{route_id}/clients-count")
def route_clients_count(route_id: int, db: Session = Depends(get_db)):
    """Кількість активних клієнтів на маршруті — для UI підказки перед деактивацією."""
    r = db.get(Route, route_id)
    if not r:
        raise HTTPException(status_code=404, detail="Маршрут не знайдено")
    n = db.query(Client).filter(
        Client.route_id == route_id, Client.is_active == 1
    ).count()
    return {"route_id": route_id, "name": r.name, "active_clients": n}


@router.delete("/{route_id}", status_code=204)
def deactivate_route(
    route_id: int,
    reassign_to_id: Optional[int] = Query(
        None,
        description="ID цільового маршруту для переносу активних клієнтів. "
                    "Якщо не вказано і клієнти є — 409 Conflict.",
    ),
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """
    Деактивує маршрут.

    Якщо є активні клієнти:
    - без `reassign_to_id` → 409 Conflict з кількістю клієнтів
    - з `reassign_to_id` → переносить клієнтів на цільовий маршрут і деактивує

    Жодних DELETE — лише soft-delete через is_active=0,
    щоб не порушити FK історії (старі замовлення зберігають route_id).
    """
    r = db.get(Route, route_id)
    if not r:
        raise HTTPException(status_code=404, detail="Маршрут не знайдено")

    active = db.query(Client).filter(
        Client.route_id == route_id, Client.is_active == 1
    ).all()

    if active:
        if reassign_to_id is None:
            raise HTTPException(
                status_code=409,
                detail=f"Маршрут має {len(active)} активних клієнтів. "
                       f"Вкажіть reassign_to_id для переносу або перенесіть вручну.",
            )
        if reassign_to_id == route_id:
            raise HTTPException(
                status_code=400,
                detail="Цільовий маршрут не може збігатись із поточним",
            )
        target = db.get(Route, reassign_to_id)
        if not target or not target.is_active:
            raise HTTPException(
                status_code=400,
                detail=f"Цільовий маршрут id={reassign_to_id} не існує або деактивований",
            )
        for c in active:
            c.route_id = reassign_to_id

    r.is_active = 0
    safe_commit(db)
