import { Router } from "express";
import mongoose from "mongoose";

import { Alerta } from "./model.js";
import { registrarCliente } from "./sse.js";

export const router = Router();

router.get("/alertas/health", (req, res) => {
  res.json({ status: "ok", service: "alertas" });
});

// Fluxo em tempo real (Server-Sent Events). Deve vir antes de /alertas/:id.
router.get("/alertas/stream", (req, res) => registrarCliente(req, res));

// Lista alertas. Filtros: ?status=ATIVO|RESOLVIDO|ENCERRADO (aceita lista
// separada por virgula, ex.: RESOLVIDO,ENCERRADO)&produto_id=...&limite=100
router.get("/alertas", async (req, res) => {
  const filtro = {};
  if (req.query.status) {
    const status = String(req.query.status).toUpperCase().split(",").map((s) => s.trim());
    if (!status.every((s) => ["ATIVO", "RESOLVIDO", "ENCERRADO"].includes(s))) {
      return res.status(400).json({ erro: "status deve ser ATIVO, RESOLVIDO ou ENCERRADO" });
    }
    filtro.status = { $in: status };
  }
  if (req.query.produto_id) filtro.produto_id = String(req.query.produto_id);
  const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 100, 1), 500);

  try {
    const lista = await Alerta.find(filtro).sort({ atualizado_em: -1 }).limit(limite);
    res.json(lista);
  } catch (err) {
    console.error("[alertas] erro ao listar:", err);
    res.status(500).json({ erro: "erro interno" });
  }
});

router.get("/alertas/:id", async (req, res) => {
  const alerta = mongoose.isValidObjectId(req.params.id)
    ? await Alerta.findById(req.params.id)
    : null;
  if (!alerta) return res.status(404).json({ erro: "Alerta nao encontrado" });
  res.json(alerta);
});
