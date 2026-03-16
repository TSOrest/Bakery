"""Ендпоінти для маршрутів."""

from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models.references import Route
from backend.schemas.references import RouteCreate, RouteOut

router = APIRouter(prefix="/routes", tags=["Маршрути"])


@router.get("/", response_model=List[RouteOut])
def list_routes(active_only: bool = True, db: Session = Depends(get_db)):
    q = db.query(Route)
    if active_only:
        q = q.filter(Route.is_active == 1)
    return q.order_by(Route.sort_order, Route.name).all()


@router.post("/", response_model=RouteOut, status_code=201)
def create_route(data: RouteCreate, db: Session = Depends(get_db)):
    r = Route(**data.model_dump())
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


@router.put("/{route_id}", response_model=RouteOut)
def update_route(route_id: int, data: RouteCreate, db: Session = Depends(get_db)):
    r = db.get(Route, route_id)
    if not r:
        raise HTTPException(status_code=404, detail="Маршрут не знайдено")
    for field, value in data.model_dump().items():
        setattr(r, field, value)
    db.commit()
    db.refresh(r)
    return r
