"""Conexao e topologia do RabbitMQ (ver docs/eventos.md)."""

import os

import pika

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")
EXCHANGE = os.getenv("EVENTS_EXCHANGE", "estoque.eventos")
DLX = os.getenv("EVENTS_DLX", "estoque.dlx")

# Fila PROPRIA deste servico, ligada aos eventos que lhe interessam.
FILA = "estoque.produtos"
FILA_DLQ = f"{FILA}.dlq"
ROUTING_KEYS = ["produto.*"]


def conectar() -> pika.BlockingConnection:
    params = pika.URLParameters(RABBITMQ_URL)
    params.heartbeat = 60
    return pika.BlockingConnection(params)


def declarar_exchange(ch) -> None:
    ch.exchange_declare(exchange=EXCHANGE, exchange_type="topic", durable=True)


def declarar_topologia_consumidor(ch) -> None:
    """O consumidor declara a propria fila e a liga a exchange.
    O produtor (Catalogo) nao precisa saber que esta fila existe."""
    declarar_exchange(ch)
    ch.exchange_declare(exchange=DLX, exchange_type="topic", durable=True)

    # Fila de descarte: recebe mensagens que falharam no processamento.
    ch.queue_declare(queue=FILA_DLQ, durable=True)
    ch.queue_bind(queue=FILA_DLQ, exchange=DLX, routing_key=FILA)

    ch.queue_declare(
        queue=FILA,
        durable=True,
        arguments={
            "x-dead-letter-exchange": DLX,
            "x-dead-letter-routing-key": FILA,
        },
    )
    for rk in ROUTING_KEYS:
        ch.queue_bind(queue=FILA, exchange=EXCHANGE, routing_key=rk)
