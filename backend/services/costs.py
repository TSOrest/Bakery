"""Сервіс розрахунку собівартості виробів."""

from datetime import datetime
from sqlalchemy.orm import Session

from backend.models.references import Product, Ingredient, ProductIngredient


def calculate_cost(db: Session, product_id: int) -> float:
    """
    Розраховує собівартість одного виробу як суму:
        qty_per_unit * ingredient.price_per_unit  для кожного інгредієнта.
    Оновлює products.cost_per_unit і повертає нове значення.
    """
    rows = (
        db.query(ProductIngredient)
        .filter(ProductIngredient.product_id == product_id)
        .all()
    )
    cost = 0.0
    for r in rows:
        ing = db.get(Ingredient, r.ingredient_id)
        if ing:
            cost += r.qty_per_unit * ing.price_per_unit

    product = db.get(Product, product_id)
    if product:
        product.cost_per_unit = round(cost, 4)
        db.commit()

    return round(cost, 4)


def recalculate_all_costs(db: Session) -> int:
    """
    Перераховує собівартість усіх активних виробів.
    Повертає кількість оновлених записів.
    """
    products = db.query(Product).filter(Product.is_active == 1).all()
    for p in products:
        rows = (
            db.query(ProductIngredient)
            .filter(ProductIngredient.product_id == p.id)
            .all()
        )
        cost = sum(
            r.qty_per_unit * (db.get(Ingredient, r.ingredient_id).price_per_unit or 0)
            for r in rows
            if db.get(Ingredient, r.ingredient_id)
        )
        p.cost_per_unit = round(cost, 4)
    db.commit()
    return len(products)
