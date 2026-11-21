import threading
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.database import SessionLocal
from app.models import ItemEstoque, Movimentacao, OutboxEvento
from app.servico import (
    ErroNegocio,
    EventoInvalido,
    estornar,
    movimentar,
    processar_evento_produto,
)


def evento(tipo, versao, **dados):
    dados.setdefault("produto_id", f"p-{uuid4().hex[:8]}")
    return {"event_id": str(uuid4()), "tipo": tipo, "versao": versao, "dados": dados}


def criado(produto_id=None, inicial=0, minimo=10):
    return evento(
        "produto.criado", 1,
        produto_id=produto_id or f"p-{uuid4().hex[:8]}",
        nome="Teclado", sku=f"SKU-{uuid4().hex[:6]}", categoria=None,
        estoque_minimo=minimo, estoque_inicial=inicial,
    )


def novo_produto(db, inicial=0, minimo=10):
    ev = criado(inicial=inicial, minimo=minimo)
    processar_evento_produto(db, ev)
    db.commit()
    return ev["dados"]["produto_id"]


def outbox_de(db, produto_id):
    return [
        o.payload for o in db.scalars(select(OutboxEvento).order_by(OutboxEvento.id))
        if o.payload["dados"].get("produto_id") == produto_id
    ]


# ------------------------------------------------- replicacao do catalogo


def test_produto_criado_replica_e_registra_entrada_inicial(db):
    pid = novo_produto(db, inicial=50)
    item = db.get(ItemEstoque, pid)
    assert item.saldo == 50
    movs = db.scalars(select(Movimentacao).where(Movimentacao.produto_id == pid)).all()
    assert [(m.tipo, m.quantidade, m.origem) for m in movs] == [("ENTRADA", 50, "ESTOQUE_INICIAL")]
    assert outbox_de(db, pid)[-1]["dados"]["saldo_atual"] == 50


def test_evento_duplicado_nao_tem_efeito(db):
    ev = criado(inicial=10)
    assert processar_evento_produto(db, ev) == "aplicado"
    db.commit()
    assert processar_evento_produto(db, ev) == "duplicado"
    db.commit()
    assert db.get(ItemEstoque, ev["dados"]["produto_id"]).saldo == 10


def test_evento_com_versao_antiga_e_ignorado(db):
    ev = criado()
    pid = ev["dados"]["produto_id"]
    processar_evento_produto(db, ev)
    novo = evento("produto.atualizado", 3, produto_id=pid, nome="Novo", sku="S", estoque_minimo=5)
    antigo = evento("produto.atualizado", 2, produto_id=pid, nome="Antigo", sku="S", estoque_minimo=1)
    assert processar_evento_produto(db, novo) == "aplicado"
    assert processar_evento_produto(db, antigo) == "ignorado"
    db.commit()
    assert db.get(ItemEstoque, pid).nome == "Novo"


def test_mudanca_de_minimo_publica_estoque_atualizado(db):
    pid = novo_produto(db, inicial=8, minimo=5)
    processar_evento_produto(
        db, evento("produto.atualizado", 2, produto_id=pid, nome="T", sku="S", estoque_minimo=20)
    )
    db.commit()
    ultimo = outbox_de(db, pid)[-1]
    assert ultimo["dados"]["motivo"] == "MINIMO_ALTERADO"
    assert ultimo["dados"]["estoque_minimo"] == 20
    assert ultimo["dados"]["saldo_atual"] == ultimo["dados"]["saldo_anterior"] == 8


def test_produto_removido_bloqueia_movimentacoes(db):
    pid = novo_produto(db, inicial=5)
    processar_evento_produto(db, evento("produto.removido", 2, produto_id=pid))
    db.commit()
    with pytest.raises(ErroNegocio) as e:
        movimentar(db, pid, "ENTRADA", 1)
    assert e.value.status == 409


def test_produto_removido_publica_estoque_atualizado_sem_mudar_saldo(db):
    pid = novo_produto(db, inicial=5)
    processar_evento_produto(db, evento("produto.removido", 2, produto_id=pid))
    db.commit()
    ultimo = outbox_de(db, pid)[-1]
    assert ultimo["dados"]["motivo"] == "PRODUTO_REMOVIDO"
    assert ultimo["dados"]["ativo"] is False
    assert ultimo["dados"]["saldo_atual"] == 5
    assert db.get(ItemEstoque, pid).saldo == 5
    movs = db.scalars(select(Movimentacao).where(Movimentacao.produto_id == pid)).all()
    assert len(movs) == 1  # so a ENTRADA inicial: remover nao gera movimentacao


def test_evento_mal_formado_e_invalido(db):
    with pytest.raises(EventoInvalido):
        processar_evento_produto(db, {"tipo": "produto.criado"})
    with pytest.raises(EventoInvalido):
        processar_evento_produto(db, evento("produto.criado", 1, produto_id="x"))  # sem nome/sku


# ------------------------------------------------------ movimentacoes


def test_saida_e_entrada_atualizam_saldo_e_geram_evento(db):
    pid = novo_produto(db, inicial=10)
    m = movimentar(db, pid, "SAIDA", 4)
    db.commit()
    assert m.saldo_apos == 6
    ev = outbox_de(db, pid)[-1]
    assert ev["tipo"] == "estoque.atualizado"
    assert (ev["dados"]["saldo_anterior"], ev["dados"]["saldo_atual"]) == (10, 6)
    assert ev["dados"]["movimentacao_id"] == m.id


def test_saida_maior_que_saldo_e_recusada_sem_efeito(db):
    pid = novo_produto(db, inicial=3)
    with pytest.raises(ErroNegocio) as e:
        movimentar(db, pid, "SAIDA", 4)
    assert e.value.status == 409
    assert e.value.extra["saldo_atual"] == 3
    db.rollback()
    assert db.get(ItemEstoque, pid, populate_existing=True).saldo == 3


def test_produto_desconhecido_retorna_404(db):
    with pytest.raises(ErroNegocio) as e:
        movimentar(db, "nao-existe", "ENTRADA", 1)
    assert e.value.status == 404


@pytest.mark.parametrize("tipo,qtd", [("SAIDA", 0), ("SAIDA", -1), ("TROCA", 1)])
def test_dados_invalidos_retornam_400(db, tipo, qtd):
    pid = novo_produto(db, inicial=1)
    with pytest.raises(ErroNegocio) as e:
        movimentar(db, pid, tipo, qtd)
    assert e.value.status == 400


def test_saidas_concorrentes_nunca_deixam_saldo_negativo():
    with SessionLocal() as db:
        pid = novo_produto(db, inicial=10)

    resultados = []

    def vender():
        with SessionLocal() as s:
            try:
                movimentar(s, pid, "SAIDA", 3)
                s.commit()
                resultados.append("ok")
            except ErroNegocio:
                s.rollback()
                resultados.append("recusada")

    threads = [threading.Thread(target=vender) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert resultados.count("ok") == 3  # 3 x 3 = 9 <= 10
    with SessionLocal() as db:
        assert db.get(ItemEstoque, pid).saldo == 1


# ------------------------------------------------------------ estorno


def test_estorno_cria_movimentacao_oposta(db):
    pid = novo_produto(db, inicial=10)
    venda = movimentar(db, pid, "SAIDA", 4)
    db.commit()
    est = estornar(db, venda.id, None)
    db.commit()
    assert (est.tipo, est.quantidade, est.estorno_de, est.origem) == ("ENTRADA", 4, venda.id, "ESTORNO")
    assert est.saldo_apos == 10


def test_nao_estorna_duas_vezes_nem_estorno_de_estorno(db):
    pid = novo_produto(db, inicial=10)
    venda = movimentar(db, pid, "SAIDA", 2)
    db.commit()
    est = estornar(db, venda.id, None)
    db.commit()
    with pytest.raises(ErroNegocio) as e1:
        estornar(db, venda.id, None)
    assert e1.value.status == 409
    db.rollback()
    with pytest.raises(ErroNegocio) as e2:
        estornar(db, est.id, None)
    assert e2.value.status == 400


def test_estorno_de_entrada_respeita_saldo(db):
    pid = novo_produto(db, inicial=0)
    entrada = movimentar(db, pid, "ENTRADA", 5)
    movimentar(db, pid, "SAIDA", 4)
    db.commit()
    with pytest.raises(ErroNegocio) as e:
        estornar(db, entrada.id, None)  # tiraria 5 com saldo 1
    assert e.value.status == 409


def test_versao_do_estoque_cresce_a_cada_mudanca(db):
    pid = novo_produto(db, inicial=5)
    movimentar(db, pid, "SAIDA", 1)
    movimentar(db, pid, "ENTRADA", 1)
    db.commit()
    versoes = [p["versao"] for p in outbox_de(db, pid)]
    assert versoes == sorted(versoes) and len(set(versoes)) == len(versoes)
    assert db.scalar(select(func.count()).select_from(Movimentacao).where(Movimentacao.produto_id == pid)) == 3
