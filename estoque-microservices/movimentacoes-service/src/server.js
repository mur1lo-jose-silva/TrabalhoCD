import express from "express";
import client from "prom-client";

import { conectarMongo } from "./db.js";
import { conectarRabbit } from "./publisher.js";
import { router } from "./routes.js";

const app = express();
app.use(express.json());

// ----- Metricas Prometheus -----
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequests = new client.Counter({
  name: "http_requests_total",
  help: "Total de requisicoes HTTP",
  labelNames: ["method", "route", "status"],
  registers: [register],
});

app.use((req, res, next) => {
  res.on("finish", () => {
    httpRequests.inc({
      method: req.method,
      route: req.path,
      status: res.statusCode,
    });
  });
  next();
});

app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});
// --------------------------------

app.use(router);

const PORT = process.env.PORT || 3000;

async function iniciar() {
  await conectarMongo();
  await conectarRabbit();
  app.listen(PORT, () =>
    console.log(`[movimentacoes] rodando na porta ${PORT}`)
  );
}

iniciar();
