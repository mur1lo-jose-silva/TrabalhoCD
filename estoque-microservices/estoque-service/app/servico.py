"""Regras de negocio do Estoque.

Todas as funcoes recebem uma sessao e NAO fazem commit: quem chama (rota HTTP
ou consumidor de eventos) decide o fim da transacao. Assim, alterar o saldo,
gravar a movimentacao e gravar o evento no outbox acontecem juntos ou nao
acontecem.
"""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from .models import EventoProcessado, ItemEstoque, Movimentacao, OutboxEvento

ORIGEM = "estoque-service"
OPOSTO = {"ENTRADA": "SAIDA", "SAIDA": "ENTRADA"}


class ErroNegocio(Exception):
    def __init__(self, status: int, mensagem: str, **extra):
        super().__init__(mensagem)
        self.status = status
        self.mensagem = mensagem
        self.extra = extra


class EventoInvalido(Exception):
    """Evento mal formado: nao adianta reprocessar, vai para a DLQ."""


# ---------------------------------------------------------------- eventos


def novo_evento(tipo: str, versao: int, dados: dict) -> dict:
    return {
        "event_id": str(uuid4()),
        "tipo": tipo,
        "versao": versao,
        "ocorrido_em": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "origem": ORIGEM,
        "dados": dados,
    }


def _gravar_outbox(db: Session, evento: dict) -> None:
    db.add(
        OutboxEvento(event_id=evento["event_id"], tipo=evento["tipo"], payload=evento)
    )


def _evento_estoque_atualizado(
    db: Session,
    *,
    produto_id: str,
    nome: str,
    sku: str,
    saldo_anterior: int,
    saldo_atual: int,
    estoque_minimo: int,
    versao_estoque: int,
    movimentacao_id: int | None,
    motivo: str,
) -> None:
    _gravar_outbox(
        db,
        novo_evento(
            "estoque.atualizado",
            versao_estoque,
            {
                "produto_id": produto_id,
                "nome": nome,
                "sku": sku,
                "saldo_anterior": saldo_anterior,
                "saldo_atual": saldo_atual,
                "estoque_minimo": estoque_minimo,
                "movimentacao_id": movimentacao_id,
                "motivo": motivo,
            },
        ),
    )


# ---------------------------------------------------------- movimentacoes


def movimentar(
    db: Session,
    produto_id: str,
    tipo: str,
    quantidade: int,
    observacao: str | None = None,
    origem: str = "API",
    estorno_de: int | None = None,
) -> Movimentacao:
    """Registra uma ENTRADA ou SAIDA e atualiza o saldo.

    A validacao de saldo e feita num UNICO UPDATE condicional
    (WHERE saldo >= quantidade). Duas vendas simultaneas nunca conseguem
    deixar o saldo negativo, sem precisar de bloqueio manual.
    """
    if tipo not in OPOSTO:
        raise ErroNegocio(400, "tipo deve ser ENTRADA ou SAIDA")
    if quantidade <= 0:
        raise ErroNegocio(400, "quantidade deve ser maior que zero")

    delta = quantidade if tipo == "ENTRADA" else -quantidade
    condicoes = [ItemEstoque.produto_id == produto_id, ItemEstoque.ativo.is_(True)]
    if delta < 0:
        condicoes.append(ItemEstoque.saldo >= quantidade)

    linha = db.execute(
        update(ItemEstoque)
        .where(*condicoes)
        .values(
            saldo=ItemEstoque.saldo + delta,
            versao_estoque=ItemEstoque.versao_estoque + 1,
        )
        .returning(
            ItemEstoque.saldo,
            ItemEstoque.nome,
            ItemEstoque.sku,
            ItemEstoque.estoque_minimo,
            ItemEstoque.versao_estoque,
        )
        .execution_options(synchronize_session=False)
    ).one_or_none()

    if linha is None:
        item = db.get(ItemEstoque, produto_id, populate_existing=True)
        if item is None:
            raise ErroNegocio(
                404,
                "Produto nao encontrado no estoque. Se ele acabou de ser "
                "cadastrado, aguarde alguns instantes (sincronizacao).",
            )
        if not item.ativo:
            raise ErroNegocio(409, "Produto removido do catalogo: movimentacoes bloqueadas")
        raise ErroNegocio(
            409,
            "Saldo insuficiente",
            saldo_atual=item.saldo,
            quantidade_solicitada=quantidade,
        )

    mov = Movimentacao(
        produto_id=produto_id,
        tipo=tipo,
        quantidade=quantidade,
        observacao=observacao,
        origem=origem,
        estorno_de=estorno_de,
        saldo_apos=linha.saldo,
    )
    db.add(mov)
    db.flush()  # gera o id da movimentacao

    _evento_estoque_atualizado(
        db,
        produto_id=produto_id,
        nome=linha.nome,
        sku=linha.sku,
        saldo_anterior=linha.saldo - delta,
        saldo_atual=linha.saldo,
        estoque_minimo=linha.estoque_minimo,
        versao_estoque=linha.versao_estoque,
        movimentacao_id=mov.id,
        motivo="MOVIMENTACAO",
    )
    return mov


def estornar(db: Session, movimentacao_id: int, observacao: str | None) -> Movimentacao:
    """Corrige uma movimentacao criando outra de tipo oposto.

    O historico nunca e reescrito: a original continua la e o estorno
    aponta para ela.
    """
    original = db.get(Movimentacao, movimentacao_id, with_for_update=True)
    if original is None:
        raise ErroNegocio(404, "Movimentacao nao encontrada")
    if original.estorno_de is not None:
        raise ErroNegocio(400, "Nao e possivel estornar um estorno")
    ja_estornada = db.scalar(
        select(Movimentacao.id).where(Movimentacao.estorno_de == movimentacao_id)
    )
    if ja_estornada:
        raise ErroNegocio(409, "Movimentacao ja estornada", estornada_por=ja_estornada)

    return movimentar(
        db,
        original.produto_id,
        OPOSTO[original.tipo],
        original.quantidade,
        observacao or f"Estorno da movimentacao {movimentacao_id}",
        origem="ESTORNO",
        estorno_de=movimentacao_id,
    )


# ------------------------------------------------- eventos do Catalogo


def _validar_evento(evento: dict) -> tuple[str, str, int, dict]:
    try:
        event_id = str(evento["event_id"])
        tipo = str(evento["tipo"])
        versao = int(evento["versao"])
        dados = evento["dados"]
        if not isinstance(dados, dict) or not dados.get("produto_id"):
            raise ValueError("dados.produto_id ausente")
    except (KeyError, TypeError, ValueError) as e:
        raise EventoInvalido(f"evento mal formado: {e}") from e
    return event_id, tipo, versao, dados


def _aplicar_snapshot(item: ItemEstoque, dados: dict, versao: int) -> None:
    try:
        item.nome = dados["nome"]
        item.sku = dados["sku"]
        item.categoria = dados.get("categoria")
        item.estoque_minimo = int(dados.get("estoque_minimo") or 0)
    except (KeyError, TypeError, ValueError) as e:
        raise EventoInvalido(f"dados do produto incompletos: {e}") from e
    item.versao = versao


def _criar_item(db: Session, dados: dict, versao: int) -> ItemEstoque:
    item = ItemEstoque(
        produto_id=dados["produto_id"], saldo=0, ativo=True, versao_estoque=0
    )
    _aplicar_snapshot(item, dados, versao)
    db.add(item)
    db.flush()
    return item


def processar_evento_produto(db: Session, evento: dict) -> str:
    """Aplica um evento produto.* na copia local. Devolve o resultado:
    'aplicado', 'duplicado' ou 'ignorado'."""
    event_id, tipo, versao, dados = _validar_evento(evento)

    # Idempotencia: se o event_id ja existe, o INSERT nao faz nada.
    novo = db.execute(
        pg_insert(EventoProcessado)
        .values(event_id=event_id, tipo=tipo)
        .on_conflict_do_nothing()
        .returning(EventoProcessado.event_id)
    ).first()
    if novo is None:
        return "duplicado"

    produto_id = dados["produto_id"]
    item = db.get(ItemEstoque, produto_id, with_for_update=True)

    if tipo == "produto.criado":
        if item is None:
            item = _criar_item(db, dados, versao)
        elif versao > item.versao:
            _aplicar_snapshot(item, dados, versao)
            db.flush()

        try:
            inicial = int(dados.get("estoque_inicial") or 0)
        except (TypeError, ValueError) as e:
            raise EventoInvalido("estoque_inicial invalido") from e
        if inicial > 0 and item.ativo:
            # O estoque inicial vira uma ENTRADA: o saldo so muda por movimentacao.
            movimentar(
                db, produto_id, "ENTRADA", inicial, "Estoque inicial",
                origem="ESTOQUE_INICIAL",
            )
        return "aplicado"

    if tipo == "produto.atualizado":
        if item is None:
            _criar_item(db, dados, versao)
            return "aplicado"
        if versao <= item.versao:
            return "ignorado"  # evento antigo ou repetido

        minimo_anterior = item.estoque_minimo
        _aplicar_snapshot(item, dados, versao)
        if item.estoque_minimo != minimo_anterior:
            # O Alertas precisa reavaliar o produto com o novo minimo.
            item.versao_estoque += 1
            _evento_estoque_atualizado(
                db,
                produto_id=produto_id,
                nome=item.nome,
                sku=item.sku,
                saldo_anterior=item.saldo,
                saldo_atual=item.saldo,
                estoque_minimo=item.estoque_minimo,
                versao_estoque=item.versao_estoque,
                movimentacao_id=None,
                motivo="MINIMO_ALTERADO",
            )
        return "aplicado"

    if tipo == "produto.removido":
        if item is None or versao <= item.versao:
            return "ignorado"
        item.ativo = False
        item.versao = versao
        return "aplicado"

    return "ignorado"  # tipo desconhecido: nao interessa a este servico
