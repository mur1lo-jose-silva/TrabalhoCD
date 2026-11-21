"""Consumidor dos eventos produto.* publicados pelo Catalogo.

Mantem a copia local dos produtos. Gracas a ela, o Estoque registra
movimentacoes mesmo com o Catalogo fora do ar (autonomia de dados).
"""

import json
import threading
import time

import pika
from sqlalchemy.exc import OperationalError

from .database import SessionLocal
from .mensageria import FILA, conectar, declarar_topologia_consumidor
from .metricas import eventos_consumidos, movimentacoes_registradas
from .outbox import notificar_outbox
from .servico import EventoInvalido, processar_evento_produto


def _log(msg: str) -> None:
    print(f"[consumer] {msg}", flush=True)


def _processar(ch, method, properties, body) -> None:
    try:
        evento = json.loads(body)
        if not isinstance(evento, dict):
            raise ValueError("evento nao e um objeto JSON")
    except ValueError as e:
        _log(f"mensagem invalida, enviada para a DLQ: {e}")
        eventos_consumidos.labels(tipo="desconhecido", resultado="invalido").inc()
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
        return

    tipo = str(evento.get("tipo", "desconhecido"))
    db = SessionLocal()
    try:
        resultado = processar_evento_produto(db, evento)
        db.commit()
    except EventoInvalido as e:
        db.rollback()
        _log(f"{tipo} invalido, enviado para a DLQ: {e}")
        eventos_consumidos.labels(tipo=tipo, resultado="invalido").inc()
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
        return
    except OperationalError as e:
        # Falha temporaria (ex.: Postgres fora): devolve para a fila e tenta depois.
        db.rollback()
        _log(f"banco indisponivel, {tipo} volta para a fila: {e.__class__.__name__}")
        eventos_consumidos.labels(tipo=tipo, resultado="reenfileirado").inc()
        time.sleep(3)
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)
        return
    except Exception as e:  # noqa: BLE001
        # Erro inesperado: nao trava a fila, vai para a DLQ para analise.
        db.rollback()
        _log(f"erro ao processar {tipo}, enviado para a DLQ: {e!r}")
        eventos_consumidos.labels(tipo=tipo, resultado="erro").inc()
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
        return
    finally:
        db.close()

    # So confirma DEPOIS do commit: se cair antes, o broker reentrega.
    ch.basic_ack(delivery_tag=method.delivery_tag)
    eventos_consumidos.labels(tipo=tipo, resultado=resultado).inc()
    _log(
        f"{tipo} v{evento.get('versao')} produto "
        f"{(evento.get('dados') or {}).get('produto_id')}: {resultado}"
    )
    if resultado == "aplicado":
        if tipo == "produto.criado" and int((evento.get("dados") or {}).get("estoque_inicial") or 0) > 0:
            movimentacoes_registradas.labels(tipo="ENTRADA", origem="ESTOQUE_INICIAL").inc()
        notificar_outbox()  # pode ter gerado estoque.atualizado


def _consumir() -> None:
    """Laco resiliente: reconecta se o RabbitMQ cair ou ainda nao estiver pronto."""
    while True:
        try:
            conexao = conectar()
            canal = conexao.channel()
            declarar_topologia_consumidor(canal)
            canal.basic_qos(prefetch_count=1)  # um evento por vez, em ordem
            canal.basic_consume(queue=FILA, on_message_callback=_processar)
            _log(f"aguardando eventos na fila '{FILA}'")
            canal.start_consuming()
        except pika.exceptions.AMQPConnectionError:
            _log("RabbitMQ indisponivel, nova tentativa em 5s")
            time.sleep(5)
        except Exception as e:  # noqa: BLE001
            _log(f"conexao perdida ({e.__class__.__name__}), reconectando em 5s")
            time.sleep(5)


def iniciar_consumidor() -> None:
    threading.Thread(target=_consumir, name="consumer", daemon=True).start()
