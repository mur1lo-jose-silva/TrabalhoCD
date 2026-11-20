from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from prometheus_fastapi_instrumentator import Instrumentator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import schemas
from .consumer import iniciar_consumidor
from .database import criar_tabelas, get_db
from .metricas import movimentacoes_recusadas, movimentacoes_registradas
from .models import ItemEstoque, Movimentacao
from .outbox import iniciar_outbox, notificar_outbox
from .servico import ErroNegocio, estornar, movimentar


@asynccontextmanager
async def lifespan(app: FastAPI):
    criar_tabelas()
    iniciar_consumidor()  # escuta produto.* (copia local do catalogo)
    iniciar_outbox()      # publica estoque.atualizado
    yield


app = FastAPI(title="Servico de Estoque", version="2.0.0", lifespan=lifespan)

# Expoe metricas em /metrics para o Prometheus coletar.
Instrumentator().instrument(app).expose(app)


# ---------------------------------------------- formato padrao de erro
# Mesmo formato do Catalogo: {"erro": "..."}.


@app.exception_handler(ErroNegocio)
async def _erro_negocio(request: Request, exc: ErroNegocio):
    return JSONResponse(status_code=exc.status, content={"erro": exc.mensagem, **exc.extra})


@app.exception_handler(StarletteHTTPException)
async def _erro_http(request: Request, exc: StarletteHTTPException):
    return JSONResponse(status_code=exc.status_code, content={"erro": exc.detail})


@app.exception_handler(RequestValidationError)
async def _erro_validacao(request: Request, exc: RequestValidationError):
    detalhes = [
        {"campo": ".".join(str(p) for p in e["loc"] if p != "body"), "mensagem": e["msg"]}
        for e in exc.errors()
    ]
    return JSONResponse(status_code=400, content={"erro": "dados invalidos", "detalhes": detalhes})


# ------------------------------------------------------------- helpers


def _saldo_out(item: ItemEstoque) -> schemas.SaldoOut:
    return schemas.SaldoOut(
        produto_id=item.produto_id,
        nome=item.nome,
        sku=item.sku,
        categoria=item.categoria,
        saldo=item.saldo,
        estoque_minimo=item.estoque_minimo,
        abaixo_minimo=item.saldo < item.estoque_minimo,
        ativo=item.ativo,
        atualizado_em=item.atualizado_em,
    )


def _movs_out(db: Session, movs: list[Movimentacao]) -> list[schemas.MovimentacaoOut]:
    """Acrescenta 'estornada_por' (id do estorno, se houver) a cada movimentacao."""
    ids = [m.id for m in movs]
    estornos = (
        dict(
            db.execute(
                select(Movimentacao.estorno_de, Movimentacao.id).where(
                    Movimentacao.estorno_de.in_(ids)
                )
            ).all()
        )
        if ids
        else {}
    )
    saida = []
    for m in movs:
        out = schemas.MovimentacaoOut.model_validate(m)
        out.estornada_por = estornos.get(m.id)
        saida.append(out)
    return saida


def _registrar(db: Session, acao) -> Movimentacao:
    """Executa a acao numa transacao e acorda o outbox apos o commit."""
    try:
        mov = acao()
        db.commit()
    except ErroNegocio as e:
        db.rollback()
        movimentacoes_recusadas.labels(motivo=e.mensagem.split(".")[0]).inc()
        raise
    except IntegrityError:
        # Ex.: dois estornos simultaneos da mesma movimentacao (UNIQUE estorno_de).
        db.rollback()
        movimentacoes_recusadas.labels(motivo="conflito").inc()
        raise ErroNegocio(409, "Conflito ao registrar a movimentacao, tente novamente")
    movimentacoes_registradas.labels(tipo=mov.tipo, origem=mov.origem).inc()
    notificar_outbox()
    return mov


# ---------------------------------------------------------------- rotas


@app.get("/estoque/health")
def health():
    return {"status": "ok", "service": "estoque"}


@app.get("/estoque/saldos", response_model=list[schemas.SaldoOut])
def listar_saldos(incluir_inativos: bool = False, db: Session = Depends(get_db)):
    consulta = select(ItemEstoque).order_by(ItemEstoque.nome)
    if not incluir_inativos:
        consulta = consulta.where(ItemEstoque.ativo.is_(True))
    return [_saldo_out(i) for i in db.scalars(consulta).all()]


@app.get("/estoque/saldos/{produto_id}", response_model=schemas.SaldoOut)
def obter_saldo(produto_id: str, db: Session = Depends(get_db)):
    item = db.get(ItemEstoque, produto_id)
    if item is None:
        raise HTTPException(404, "Produto nao encontrado no estoque")
    return _saldo_out(item)


@app.post("/estoque/movimentacoes", response_model=schemas.MovimentacaoOut, status_code=201)
def criar_movimentacao(payload: schemas.MovimentacaoCreate, db: Session = Depends(get_db)):
    mov = _registrar(
        db,
        lambda: movimentar(
            db, payload.produto_id, payload.tipo, payload.quantidade, payload.observacao
        ),
    )
    return _movs_out(db, [mov])[0]


@app.get("/estoque/movimentacoes", response_model=list[schemas.MovimentacaoOut])
def listar_movimentacoes(
    produto_id: str | None = None,
    tipo: str | None = Query(default=None, pattern="^(ENTRADA|SAIDA)$"),
    limite: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    consulta = select(Movimentacao).order_by(Movimentacao.id.desc()).limit(limite)
    if produto_id:
        consulta = consulta.where(Movimentacao.produto_id == produto_id)
    if tipo:
        consulta = consulta.where(Movimentacao.tipo == tipo)
    return _movs_out(db, list(db.scalars(consulta).all()))


@app.get("/estoque/movimentacoes/{movimentacao_id}", response_model=schemas.MovimentacaoOut)
def obter_movimentacao(movimentacao_id: int, db: Session = Depends(get_db)):
    mov = db.get(Movimentacao, movimentacao_id)
    if mov is None:
        raise HTTPException(404, "Movimentacao nao encontrada")
    return _movs_out(db, [mov])[0]


@app.post(
    "/estoque/movimentacoes/{movimentacao_id}/estorno",
    response_model=schemas.MovimentacaoOut,
    status_code=201,
)
def estornar_movimentacao(
    movimentacao_id: int,
    payload: schemas.EstornoCreate | None = None,
    db: Session = Depends(get_db),
):
    observacao = payload.observacao if payload else None
    mov = _registrar(db, lambda: estornar(db, movimentacao_id, observacao))
    return _movs_out(db, [mov])[0]
