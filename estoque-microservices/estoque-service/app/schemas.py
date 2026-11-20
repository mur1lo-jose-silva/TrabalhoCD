from typing import Optional

from pydantic import BaseModel


class ProdutoBase(BaseModel):
    nome: str
    sku: str
    categoria: Optional[str] = None
    preco: float = 0.0
    quantidade_estoque: int = 0
    estoque_minimo: int = 0


class ProdutoCreate(ProdutoBase):
    pass


class ProdutoUpdate(BaseModel):
    nome: Optional[str] = None
    sku: Optional[str] = None
    categoria: Optional[str] = None
    preco: Optional[float] = None
    quantidade_estoque: Optional[int] = None
    estoque_minimo: Optional[int] = None


class ProdutoOut(ProdutoBase):
    id: int

    class Config:
        from_attributes = True
