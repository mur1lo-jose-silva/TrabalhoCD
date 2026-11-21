import os
import json
import time
import threading

import pika

from .database import SessionLocal
from . import models

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")
QUEUE = os.getenv("MOVIMENTACOES_QUEUE", "movimentacoes.estoque")


def _processar_evento(ch, method, properties, body):
    """Recebe um evento de movimentação e atualiza o saldo do produto."""
    try:
        evento = json.loads(body)
    except json.JSONDecodeError:
        ch.basic_ack(delivery_tag=method.delivery_tag)
        return

    produto_id = evento.get("produto_id")
    tipo = evento.get("tipo")  # "ENTRADA" ou "SAIDA"
    quantidade = int(evento.get("quantidade", 0))

    db = SessionLocal()
    try:
        produto = db.get(models.Produto, produto_id)
        if produto:
            if tipo == "ENTRADA":
                produto.quantidade_estoque += quantidade
            elif tipo == "SAIDA":
                produto.quantidade_estoque -= quantidade
            db.commit()
            print(
                f"[consumer] Produto {produto_id}: {tipo} {quantidade} "
                f"-> novo saldo {produto.quantidade_estoque}",
                flush=True,
            )
        else:
            print(f"[consumer] Produto {produto_id} nao encontrado", flush=True)
    finally:
        db.close()

    ch.basic_ack(delivery_tag=method.delivery_tag)


def _consumir():
    """Loop resiliente: reconecta caso o RabbitMQ ainda nao esteja pronto."""
    while True:
        try:
            params = pika.URLParameters(RABBITMQ_URL)
            connection = pika.BlockingConnection(params)
            channel = connection.channel()
            channel.queue_declare(queue=QUEUE, durable=True)
            channel.basic_qos(prefetch_count=1)
            channel.basic_consume(queue=QUEUE, on_message_callback=_processar_evento)
            print("[consumer] Aguardando mensagens de movimentacao...", flush=True)
            channel.start_consuming()
        except pika.exceptions.AMQPConnectionError:
            print("[consumer] RabbitMQ indisponivel, nova tentativa em 5s...", flush=True)
            time.sleep(5)
        except Exception as e:  # noqa: BLE001
            print(f"[consumer] erro: {e}", flush=True)
            time.sleep(5)


def start_consumer_thread():
    """Inicia o consumidor em uma thread de fundo (nao bloqueia a API)."""
    t = threading.Thread(target=_consumir, daemon=True)
    t.start()
