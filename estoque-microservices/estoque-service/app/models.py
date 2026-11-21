from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class ItemEstoque(Base):
    """Copia local do produto (vinda do Catalogo por eventos) + SALDO.

    O saldo so existe aqui e so muda por movimentacao. O CHECK garante no
    proprio banco que ele nunca fica negativo.
    """

    __tablename__ = "itens_estoque"
    __table_args__ = (
        CheckConstraint("saldo >= 0", name="ck_saldo_nao_negativo"),
        CheckConstraint("estoque_minimo >= 0", name="ck_minimo_nao_negativo"),
    )

    produto_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    nome: Mapped[str] = mapped_column(String(200), nullable=False)
    sku: Mapped[str] = mapped_column(String(100), nullable=False)
    categoria: Mapped[str | None] = mapped_column(String(100))
    estoque_minimo: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    saldo: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ativo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Versao do produto no Catalogo (descarta eventos antigos/fora de ordem).
    versao: Mapped[int] = mapped_column(Integer, nullable=False)
    # Versao do saldo/minimo, publicada em estoque.atualizado.
    versao_estoque: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    atualizado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Movimentacao(Base):
    """Historico imutavel: nao ha edicao nem remocao, so estorno."""

    __tablename__ = "movimentacoes"
    __table_args__ = (
        CheckConstraint("tipo IN ('ENTRADA', 'SAIDA')", name="ck_tipo"),
        CheckConstraint("quantidade > 0", name="ck_quantidade_positiva"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    produto_id: Mapped[str] = mapped_column(
        ForeignKey("itens_estoque.produto_id"), nullable=False, index=True
    )
    tipo: Mapped[str] = mapped_column(String(10), nullable=False)
    quantidade: Mapped[int] = mapped_column(Integer, nullable=False)
    observacao: Mapped[str | None] = mapped_column(Text)
    # API, ESTOQUE_INICIAL ou ESTORNO
    origem: Mapped[str] = mapped_column(String(20), nullable=False, default="API")
    # Uma movimentacao so pode ser estornada uma vez (UNIQUE).
    estorno_de: Mapped[int | None] = mapped_column(
        ForeignKey("movimentacoes.id"), unique=True
    )
    saldo_apos: Mapped[int] = mapped_column(Integer, nullable=False)
    criado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class EventoProcessado(Base):
    """Eventos ja consumidos (idempotencia): a chave primaria impede
    que o mesmo evento seja aplicado duas vezes."""

    __tablename__ = "eventos_processados"

    event_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tipo: Mapped[str] = mapped_column(String(50), nullable=False)
    processado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class OutboxEvento(Base):
    """Eventos a publicar, gravados na MESMA transacao da mudanca de dados."""

    __tablename__ = "outbox"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    tipo: Mapped[str] = mapped_column(String(50), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    criado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    publicado_em: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), index=True
    )
