"""Pydantic-схеми для фінансового модуля."""

from pydantic import BaseModel, field_validator
from typing import Optional, Literal


FINANCE_TYPES = Literal[
    "invoice", "payment", "writeoff",
    "deposit", "route_cash", "exchange_credit",
]

FINANCE_LABELS = {
    "invoice":        "Накладна",
    "payment":        "Оплата",
    "writeoff":       "Списання",
    "deposit":        "Внесення в касу",
    "route_cash":     "Готівка водія",
    "exchange_credit": "Кредит обміну",
}

# ── Статті фінансів ────────────────────────────────────────────────────────────

class FinanceArticleCreate(BaseModel):
    name: str
    direction: Literal["income", "expense"]


class FinanceArticleUpdate(BaseModel):
    name: Optional[str] = None
    direction: Optional[Literal["income", "expense"]] = None


class FinanceArticleOut(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    name: str
    direction: str
    is_system: int


# ── Фінансові операції ─────────────────────────────────────────────────────────

class FinanceCreate(BaseModel):
    finance_date: str
    client_id:    Optional[int] = None
    finance_type: FINANCE_TYPES
    article_id:   Optional[int] = None   # якщо задано — перекриває finance_type у відображенні
    amount:       float
    sign:         Literal[1, -1]
    notes:        Optional[str] = None
    created_by:   Optional[str] = None

    @field_validator("amount")
    @classmethod
    def positive_amount(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("amount має бути > 0")
        return round(v, 2)


class FinanceOut(BaseModel):
    id:           int
    finance_date: str
    client_id:    Optional[int]
    client_name:  Optional[str] = None
    finance_type: str
    type_label:   Optional[str] = None
    article_id:   Optional[int] = None
    article_name: Optional[str] = None
    amount:       float
    sign:         int
    signed_amount: Optional[float] = None   # amount * sign
    notes:        Optional[str]
    created_at:   Optional[str]
    created_by:   Optional[str]

    model_config = {"from_attributes": True}


class ClientBalance(BaseModel):
    client_id:         int
    client_name:       str
    short_name:        Optional[str]
    route_id:          Optional[int]
    route_name:        Optional[str]
    balance:           float   # додатне = кредит; від'ємне = борг
    last_payment_date: Optional[str]
    last_invoice_date: Optional[str]
    client_kind:       str = "customer"  # customer | shop | writeoff | ration | underbaked


class FinanceSummary(BaseModel):
    total_debt:    float   # сума боргів всіх клієнтів (від'ємні баланси)
    total_credit:  float   # сума кредитів (позитивні баланси)
    net_balance:   float   # total_credit - total_debt
    clients_in_debt:   int
    clients_with_credit: int
