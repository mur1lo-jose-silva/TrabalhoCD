import client from "prom-client";

export const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const httpRequests = new client.Counter({
  name: "http_requests_total",
  help: "Total de requisicoes HTTP",
  labelNames: ["method", "route", "status"],
  registers: [register],
});

export const eventosPublicados = new client.Counter({
  name: "eventos_publicados_total",
  help: "Eventos publicados no RabbitMQ",
  labelNames: ["tipo", "resultado"],
  registers: [register],
});

export const eventosPendentes = new client.Gauge({
  name: "eventos_pendentes",
  help: "Eventos gravados no outbox aguardando publicacao",
  registers: [register],
});
