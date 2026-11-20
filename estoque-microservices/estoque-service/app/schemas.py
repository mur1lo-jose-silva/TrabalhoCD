from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class MovimentacaoCreate(BaseModel):
    produto_id: str = Field(min_length=1, max_length=64)
    tipo: Literal["ENTRADA", "SAIDA"]
    quantidade: int = Field(gt=0)
    observacao: str | None = Field(default=None, max_length=500)


class EstornoCreate(BaseModel):
    observacao: str | None = Field(default=None, max_length=500)


class MovimentacaoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    produto_id: str
    tipo: str
    quantidade: int
    observacao: str | None
    origem: str
    estorno_de: int | None
    estornada_por: int | None = None
    saldo_apos: int
    criado_em: datetime


class SaldoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    produto_id: str
    nome: str
    sku: str
    categoria: str | None
    saldo: int
    estoque_minimo: int
    abaixo_minimo: bool
    ativo: bool
    atualizado_em: datetime | None
