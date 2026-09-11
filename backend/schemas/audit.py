"""Схеми аудит-логу."""

from pydantic import BaseModel
from typing import Optional


class AuditLogOut(BaseModel):
    id:            int
    entity_table:  str
    entity_id:     int
    changed_field: str
    old_value:     Optional[str]
    new_value:     Optional[str]
    changed_by:    str
    changed_at:    Optional[str]

    model_config = {"from_attributes": True}
