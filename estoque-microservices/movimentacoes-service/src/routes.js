import { Router } from "express";

import { Movimentacao } from "./model.js";
import { publicarMovimentacao } from "./publisher.js";

export const router = Router();

router.get("/movimentacoes/health", (req, res) => {
  res.json({ status: "ok", service: "movimentacoes" });
});

// Listar todas as movimentacoes (mais recentes primeiro)
router.get("/movimentacoes", async (req, res) => {
  const lista = await Movimentacao.find().sort({ createdAt: -1 });
  res.json(lista);
});

// Criar movimentacao e PUBLICAR o evento no RabbitMQ
router.post("/movimentacoes", async (req, res) => {
  try {
    const { produto_id, tipo, quantidade, observacao } = req.body;
    const mov = await Movimentacao.create({
      produto_id,
      tipo,
      quantidade,
      observacao,
    });

    // Evento assincrono: o servico de Produtos vai consumir e atualizar o saldo.
    publicarMovimentacao({
      produto_id: mov.produto_id,
      tipo: mov.tipo,
      quantidade: mov.quantidade,
    });

    res.status(201).json(mov);
  } catch (err) {
    res.status(400).json({ erro: err.message });
  }
});

// Obter por id
router.get("/movimentacoes/:id", async (req, res) => {
  try {
    const mov = await Movimentacao.findById(req.params.id);
    if (!mov)
      return res.status(404).json({ erro: "Movimentacao nao encontrada" });
    res.json(mov);
  } catch (err) {
    res.status(400).json({ erro: "id invalido" });
  }
});

// Atualizar
router.put("/movimentacoes/:id", async (req, res) => {
  try {
    const mov = await Movimentacao.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!mov)
      return res.status(404).json({ erro: "Movimentacao nao encontrada" });
    res.json(mov);
  } catch (err) {
    res.status(400).json({ erro: err.message });
  }
});

// Remover
router.delete("/movimentacoes/:id", async (req, res) => {
  try {
    const mov = await Movimentacao.findByIdAndDelete(req.params.id);
    if (!mov)
      return res.status(404).json({ erro: "Movimentacao nao encontrada" });
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ erro: "id invalido" });
  }
});
