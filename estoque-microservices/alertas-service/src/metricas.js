import client from "prom-client";

export const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const httpRequests = new client.Counter({
  name: "http_requests_total",
  help: "Total de requisicoes HTTP",
  labelNames: ["method", "route", "status"],
  registers: [register],
});

export const eventosConsumidos = new client.Counter({
  name: "eventos_consumidos_total",
  help: "Eventos consumidos do RabbitMQ",
  labelNames: ["tipo", "resultado"],
  registers: [register],
});

export const alertasAcoes = new client.Counter({
  name: "alertas_total",
  help: "Alertas abertos, atualizados e resolvidos",
  labelNames: ["acao"],
  registers: [register],
});

export const alertasAtivos = new client.Gauge({
  name: "alertas_ativos",
  help: "Alertas de estoque baixo ativos no momento",
  registers: [register],
});

export const clientesSse = new client.Gauge({
  name: "sse_clientes_conectados",
  help: "Telas conectadas recebendo alertas em tempo real",
  registers: [register],
});
