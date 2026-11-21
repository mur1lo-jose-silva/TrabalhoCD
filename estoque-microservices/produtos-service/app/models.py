from sqlalchemy import Column, Integer, String, Float

from .database import Base


class Produto(Base):
    __tablename__ = "produtos"

    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String, nullable=False)
    sku = Column(String, unique=True, nullable=False)
    categoria = Column(String, nullable=True)
    preco = Column(Float, default=0.0)
    quantidade_estoque = Column(Integer, default=0)
    estoque_minimo = Column(Integer, default=0)
