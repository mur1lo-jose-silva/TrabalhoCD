import express from "express";

import { iniciarConsumidor } from "./consumer.js";
import { conectarMongo } from "./db.js";
import { httpRequests, register } from "./metricas.js";
import { Alerta } from "./model.js";
import { atualizarGaugeAtivos } from "./processador.js";
import { router } from "./routes.js";

const app = express();
app.use(express.json());

// ----- Metricas Prometheus (rota padronizada, sem ids no label) -----
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

app.use((req, res) => res.status(404).json({ erro: "Rota nao encontrada" }));

const PORT = process.env.PORT || 3000;

async function iniciar() {
  await conectarMongo();
  await Alerta.init(); // garante o indice "um alerta ativo por produto"
  await atualizarGaugeAtivos();

  app.listen(PORT, () => console.log(`[alertas] rodando na porta ${PORT}`));
  iniciarConsumidor(); // roda para sempre, reconectando quando preciso
}

iniciar().catch((err) => {
  console.error("[alertas] falha ao iniciar:", err);
  process.exit(1);
});
