"""Ендпоінти для статей фінансових операцій."""

from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.finances import Finance, FinanceArticle
from backend.schemas.finance import FinanceArticleCreate, FinanceArticleUpdate, FinanceArticleOut

router = APIRouter(prefix="/finances/articles", tags=["Статті фінансів"])


@router.get("/", response_model=List[FinanceArticleOut])
def list_articles(db: Session = Depends(get_db)):
    return db.query(FinanceArticle).order_by(FinanceArticle.direction, FinanceArticle.name).all()


@router.post("/", response_model=FinanceArticleOut, status_code=201)
def create_article(data: FinanceArticleCreate, db: Session = Depends(get_db)):
    article = FinanceArticle(name=data.name, direction=data.direction, is_system=0, needs_client=data.needs_client)
    db.add(article)
    db.commit()
    db.refresh(article)
    return article


@router.put("/{article_id}", response_model=FinanceArticleOut)
def update_article(article_id: int, data: FinanceArticleUpdate, db: Session = Depends(get_db)):
    article = db.get(FinanceArticle, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="Статтю не знайдено")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(article, field, value)
    db.commit()
    db.refresh(article)
    return article


@router.delete("/{article_id}", status_code=204)
def delete_article(article_id: int, db: Session = Depends(get_db)):
    article = db.get(FinanceArticle, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="Статтю не знайдено")
    if article.is_system:
        raise HTTPException(status_code=400, detail="Системну статтю не можна видалити")
    # Перевіряємо чи є прив'язані записи
    usage = db.query(Finance).filter(Finance.article_id == article_id).first()
    if usage:
        raise HTTPException(
            status_code=400,
            detail="Статтю використовується у фінансових записах — спочатку перепризначте їх",
        )
    db.delete(article)
    db.commit()
