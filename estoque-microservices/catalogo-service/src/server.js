import express from "express";

import { conectarMongo } from "./db.js";
import { conectarRabbit } from "./eventos.js";
import { httpRequests, register } from "./metricas.js";
import { Produto } from "./model.js";
import { iniciarOutbox, notificarOutbox } from "./outbox.js";
import { router } from "./routes.js";

const app = express();
app.use(express.json());

// ----- Metricas Prometheus -----
// O label "route" usa o PADRAO da rota (/produtos/:id), e nao o caminho real,
// para nao criar uma serie nova no Prometheus para cada id.
app.use((req, res, next) => {
  res.on("finish", () => {
    httpRequests.inc({
      method: req.method,
      route: req.route ? req.baseUrl + req.route.path : "nao_mapeada",
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

// JSON mal formado no corpo da requisicao
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ erro: "JSON invalido" });
  }
  next(err);
});

const PORT = process.env.PORT || 3000;

async function iniciar() {
  await conectarMongo();
  await Produto.init(); // garante o indice unico de SKU

  app.listen(PORT, () => console.log(`[catalogo] rodando na porta ${PORT}`));

  // O RabbitMQ NAO e pre-requisito para a API funcionar: se ele estiver fora,
  // os eventos ficam no outbox e sao publicados quando a conexao voltar.
  conectarRabbit(notificarOutbox);
  iniciarOutbox();
}

iniciar().catch((err) => {
  console.error("[catalogo] falha ao iniciar:", err);
  process.exit(1);
});
