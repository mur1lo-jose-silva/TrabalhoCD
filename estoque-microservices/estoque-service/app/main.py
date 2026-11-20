import time

from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError
from prometheus_fastapi_instrumentator import Instrumentator

from .database import Base, engine, get_db
from . import models, schemas
from .consumer import start_consumer_thread

# Cria as tabelas com retry, pois o Postgres pode demorar a ficar pronto.
for _ in range(10):
    try:
        Base.metadata.create_all(bind=engine)
        break
    except OperationalError:
        time.sleep(3)

app = FastAPI(title="Servico de Produtos", version="1.0.0")

# Expoe metricas em /metrics para o Prometheus coletar.
Instrumentator().instrument(app).expose(app)


@app.on_event("startup")
def startup():
    # Comeca a escutar os eventos de movimentacao vindos do RabbitMQ.
    start_consumer_thread()


@app.get("/produtos/health")
def health():
    return {"status": "ok", "service": "produtos"}


@app.get("/produtos", response_model=list[schemas.ProdutoOut])
def listar(db: Session = Depends(get_db)):
    return db.query(models.Produto).all()


@app.post("/produtos", response_model=schemas.ProdutoOut, status_code=201)
def criar(payload: schemas.ProdutoCreate, db: Session = Depends(get_db)):
    produto = models.Produto(**payload.model_dump())
    db.add(produto)
    db.commit()
    db.refresh(produto)
    return produto


@app.get("/produtos/{produto_id}", response_model=schemas.ProdutoOut)
def obter(produto_id: int, db: Session = Depends(get_db)):
    produto = db.get(models.Produto, produto_id)
    if not produto:
        raise HTTPException(status_code=404, detail="Produto nao encontrado")
    return produto


@app.put("/produtos/{produto_id}", response_model=schemas.ProdutoOut)
def atualizar(
    produto_id: int, payload: schemas.ProdutoUpdate, db: Session = Depends(get_db)
):
    produto = db.get(models.Produto, produto_id)
    if not produto:
        raise HTTPException(status_code=404, detail="Produto nao encontrado")
    for campo, valor in payload.model_dump(exclude_unset=True).items():
        setattr(produto, campo, valor)
    db.commit()
    db.refresh(produto)
    return produto


@app.delete("/produtos/{produto_id}", status_code=204)
def remover(produto_id: int, db: Session = Depends(get_db)):
    produto = db.get(models.Produto, produto_id)
    if not produto:
        raise HTTPException(status_code=404, detail="Produto nao encontrado")
    db.delete(produto)
    db.commit()
    return None
