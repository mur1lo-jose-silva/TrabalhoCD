from prometheus_client import Counter, Gauge

eventos_consumidos = Counter(
    "eventos_consumidos_total",
    "Eventos consumidos do RabbitMQ",
    ["tipo", "resultado"],
)

eventos_publicados = Counter(
    "eventos_publicados_total",
    "Eventos publicados no RabbitMQ",
    ["tipo", "resultado"],
)

eventos_pendentes = Gauge(
    "eventos_pendentes",
    "Eventos gravados no outbox aguardando publicacao",
)

movimentacoes_registradas = Counter(
    "movimentacoes_total",
    "Movimentacoes de estoque registradas",
    ["tipo", "origem"],
)

movimentacoes_recusadas = Counter(
    "movimentacoes_recusadas_total",
    "Movimentacoes recusadas pelas regras de negocio",
    ["motivo"],
)
