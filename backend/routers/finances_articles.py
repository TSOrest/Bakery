"""Ендпоінти для статей фінансових операцій."""

from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db, safe_commit
from backend.models.finances import Finance, FinanceArticle
from backend.schemas.finance import FinanceArticleCreate, FinanceArticleUpdate, FinanceArticleOut
from backend.routers.auth import require_perm, require_user

router = APIRouter(prefix="/finances/articles", tags=["Статті фінансів"])


@router.get("/", response_model=List[FinanceArticleOut])
def list_articles(db: Session = Depends(get_db), _=Depends(require_user)):
    # ⚠ Раніше без жодної auth-залежності — незахищений GET, той самий клас
    # прогалини що вже виправлено для інших довідників (High-знахідка
    # "GET довідники без входу"). Помічено при підключенні гранульованих
    # прав до цього роутера. Лише require_user (не admin_org.view) —
    # FinancesPage.tsx (журнал операцій) використовує список статей для
    # дропдауна незалежно від наявності адмінського доступу до Довідників.
    return db.query(FinanceArticle).order_by(FinanceArticle.direction, FinanceArticle.name).all()


@router.post("/", response_model=FinanceArticleOut, status_code=201)
def create_article(data: FinanceArticleCreate, db: Session = Depends(get_db), _=Depends(require_perm("admin_org.create"))):
    dup = db.query(FinanceArticle).filter(FinanceArticle.name == data.name).first()
    if dup:
        raise HTTPException(status_code=409, detail="Стаття з такою назвою вже існує")
    article = FinanceArticle(name=data.name, direction=data.direction, is_system=0, needs_client=data.needs_client)
    db.add(article)
    safe_commit(db)
    db.refresh(article)
    return article


@router.put("/{article_id}", response_model=FinanceArticleOut)
def update_article(article_id: int, data: FinanceArticleUpdate, db: Session = Depends(get_db), _=Depends(require_perm("admin_org.edit"))):
    article = db.get(FinanceArticle, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="Статтю не знайдено")
    updates = data.model_dump(exclude_none=True)
    if "name" in updates and updates["name"] != article.name:
        if article.is_system:
            raise HTTPException(
                status_code=400,
                detail="Назву системної статті не можна змінити — вона використовується в коді",
            )
        dup = (
            db.query(FinanceArticle)
            .filter(FinanceArticle.name == updates["name"], FinanceArticle.id != article_id)
            .first()
        )
        if dup:
            raise HTTPException(status_code=409, detail="Стаття з такою назвою вже існує")
    for field, value in updates.items():
        setattr(article, field, value)
    safe_commit(db)
    db.refresh(article)
    return article


@router.delete("/{article_id}", status_code=204)
def delete_article(article_id: int, db: Session = Depends(get_db), _=Depends(require_perm("admin_org.delete"))):
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
    safe_commit(db)
