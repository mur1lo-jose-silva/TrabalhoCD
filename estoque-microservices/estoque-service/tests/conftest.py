"""Os testes rodam contra um Postgres DE VERDADE (o mesmo do compose), num banco
separado "estoque_teste", recriado a cada execucao. Assim testamos as regras
que dependem do banco (UPDATE condicional, CHECK, UNIQUE, ON CONFLICT).

Como rodar (a partir da raiz do projeto):
    docker compose run --rm --no-deps -v ./estoque-service:/src -w /src \
        estoque-service sh -c "pip install -q -r requirements-dev.txt && pytest -q"
"""

import os

from sqlalchemy import create_engine, text

BASE = os.getenv("TEST_DATABASE_ADMIN_URL", "postgresql://estoque:estoque@postgres-estoque:5432/estoque")
TESTE = BASE.rsplit("/", 1)[0] + "/estoque_teste"

# Precisa ser definido ANTES de importar o app (o engine le a variavel).
os.environ["DATABASE_URL"] = TESTE

import pytest  # noqa: E402

from app.database import Base, SessionLocal, engine  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def banco_de_teste():
    admin = create_engine(BASE, isolation_level="AUTOCOMMIT")
    with admin.connect() as c:
        c.execute(text("DROP DATABASE IF EXISTS estoque_teste WITH (FORCE)"))
        c.execute(text("CREATE DATABASE estoque_teste"))
    admin.dispose()

    from app import models  # noqa: F401

    Base.metadata.create_all(engine)
    yield
    engine.dispose()


@pytest.fixture()
def db():
    sessao = SessionLocal()
    try:
        yield sessao
    finally:
        sessao.rollback()
        sessao.close()
