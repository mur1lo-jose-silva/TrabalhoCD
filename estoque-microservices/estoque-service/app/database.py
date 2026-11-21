import os
import time

from sqlalchemy import create_engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import DeclarativeBase, sessionmaker

# Cada servico acessa EXCLUSIVAMENTE seu proprio banco (Database per Service).
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://estoque:estoque@postgres-estoque:5432/estoque",
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def criar_tabelas(tentativas: int = 20) -> None:
    """Cria as tabelas, aguardando o Postgres ficar pronto."""
    from . import models  # noqa: F401  (registra os modelos no Base)

    for tentativa in range(1, tentativas + 1):
        try:
            Base.metadata.create_all(bind=engine)
            print("[postgres] tabelas prontas", flush=True)
            return
        except OperationalError:
            print(
                f"[postgres] indisponivel (tentativa {tentativa}), nova tentativa em 3s",
                flush=True,
            )
            time.sleep(3)
    raise RuntimeError("Nao foi possivel conectar ao Postgres")
