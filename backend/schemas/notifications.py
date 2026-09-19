"""Схеми сповіщень у програмі."""

from typing import Optional
from pydantic import BaseModel


class NotificationOut(BaseModel):
    id:         int
    type:       str
    title:      str
    body:       Optional[str] = None
    meta:       Optional[str] = None
    created_at: str
    read_at:    Optional[str] = None

    model_config = {"from_attributes": True}


class UnreadCount(BaseModel):
    count: int


class RequestUpdateIn(BaseModel):
    version:   str
    changelog: str = ""
