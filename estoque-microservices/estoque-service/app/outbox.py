"""Relay do Outbox: publica os eventos gravados na tabela `outbox`.

O evento e gravado na MESMA transacao da movimentacao. Este laco, numa thread
separada, le os pendentes e os publica com "publisher confirms". Se o RabbitMQ
estiver fora, os eventos esperam no banco: nada se perde.
"""

import json
import threading
import time
from datetime import datetime, timezone

import pika
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError

from .database import SessionLocal
from .mensageria import EXCHANGE, conectar, declarar_exchange
from .metricas import eventos_pendentes, eventos_publicados
from .models import OutboxEvento

_acordar = threading.Event()
LOTE = 100


def _log(msg: str) -> None:
    print(f"[outbox] {msg}", flush=True)


def notificar_outbox() -> None:
    """Acorda o relay imediatamente (chamado apos cada commit com eventos)."""
    _acordar.set()


def _atualizar_gauge() -> None:
    db = SessionLocal()
    try:
        eventos_pendentes.set(
            db.scalar(
                select(func.count()).select_from(OutboxEvento)
                .where(OutboxEvento.publicado_em.is_(None))
            )
            or 0
        )
    finally:
        db.close()


def _publicar_pendentes(canal) -> None:
    db = SessionLocal()
    try:
        pendentes = db.scalars(
            select(OutboxEvento)
            .where(OutboxEvento.publicado_em.is_(None))
            .order_by(OutboxEvento.id)
            .limit(LOTE)
        ).all()
        for ev in pendentes:
            try:
                # Com confirm_delivery, basic_publish so retorna apos o broker confirmar.
                canal.basic_publish(
                    exchange=EXCHANGE,
                    routing_key=ev.tipo,
                    body=json.dumps(ev.payload).encode(),
                    properties=pika.BasicProperties(
                        content_type="application/json",
                        delivery_mode=2,  # persistente
                        message_id=ev.event_id,
                        type=ev.tipo,
                    ),
                )
            except Exception:
                eventos_publicados.labels(tipo=ev.tipo, resultado="falha").inc()
                raise
            # Se cair entre publicar e marcar, o evento sai de novo:
            # por isso os consumidores sao idempotentes.
            ev.publicado_em = datetime.now(timezone.utc)
            db.commit()
            eventos_publicados.labels(tipo=ev.tipo, resultado="ok").inc()
            _log(f"publicado {ev.tipo} ({ev.event_id})")
    finally:
        db.close()


def _laco() -> None:
    while True:
        conexao = None
        try:
            conexao = conectar()
            canal = conexao.channel()
            canal.confirm_delivery()
            declarar_exchange(canal)
            _log("conectado ao RabbitMQ")
            while True:
                _publicar_pendentes(canal)
                _atualizar_gauge()
                conexao.process_data_events(time_limit=0)  # mantem o heartbeat
                _acordar.wait(timeout=1)
                _acordar.clear()
        except OperationalError:
            _log("Postgres indisponivel, nova tentativa em 3s")
        except pika.exceptions.AMQPError as e:
            _log(f"RabbitMQ indisponivel ({e.__class__.__name__}), nova tentativa em 3s")
        except Exception as e:  # noqa: BLE001
            _log(f"erro inesperado: {e!r}")
        finally:
            if conexao is not None and conexao.is_open:
                try:
                    conexao.close()
                except Exception:  # noqa: BLE001
                    pass
        try:
            _atualizar_gauge()
        except Exception:  # noqa: BLE001
            pass
        time.sleep(3)


def iniciar_outbox() -> None:
    threading.Thread(target=_laco, name="outbox", daemon=True).start()
