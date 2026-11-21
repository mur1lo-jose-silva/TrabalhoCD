import { Router } from "express";
import mongoose from "mongoose";

import { Produto, dadosReplicados } from "./model.js";
import { novoEvento, notificarOutbox } from "./outbox.js";

export const router = Router();

const CAMPOS_EDITAVEIS = [
  "nome",
  "sku",
  "categoria",
  "preco",
  "estoque_minimo",
  "atributos",
];
const TENTATIVAS_CONCORRENCIA = 3;

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

function selecionarCampos(body) {
  const campos = {};
  for (const c of CAMPOS_EDITAVEIS) {
    if (body?.[c] !== undefined) campos[c] = body[c];
  }
  if (
    campos.atributos !== undefined &&
    (campos.atributos === null ||
      typeof campos.atributos !== "object" ||
      Array.isArray(campos.atributos))
  ) {
    throw new ErroHttp(400, "atributos deve ser um objeto { chave: valor }");
  }
  return campos;
}

function tratarErro(res, err) {
  if (err instanceof ErroHttp)
    return res.status(err.status).json({ erro: err.message });
  if (err?.code === 11000)
    return res.status(409).json({ erro: "SKU ja cadastrado" });
  if (err instanceof mongoose.Error.ValidationError || err instanceof mongoose.Error.CastError)
    return res.status(400).json({ erro: err.message });
  console.error("[catalogo] erro inesperado:", err);
  return res.status(500).json({ erro: "erro interno" });
}

async function buscarAtivo(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  return Produto.findOne({ _id: id, ativo: true });
}

// Aplica uma mudanca com controle otimista de concorrencia: so grava se a
// versao no banco ainda for a que lemos. A mudanca e o evento (outbox) vao na
// MESMA operacao atomica de documento.
async function alterarComEvento(id, montarMudanca) {
  for (let i = 0; i < TENTATIVAS_CONCORRENCIA; i++) {
    const atual = await buscarAtivo(id);
    if (!atual) throw new ErroHttp(404, "Produto nao encontrado");

    const mudanca = await montarMudanca(atual);
    if (!mudanca) return atual; // nada mudou

    const novaVersao = atual.versao + 1;
    const evento = novoEvento(mudanca.tipo, novaVersao, mudanca.dados);
    const atualizado = await Produto.findOneAndUpdate(
      { _id: atual._id, versao: atual.versao, ativo: true },
      {
        $set: { ...mudanca.set, versao: novaVersao },
        $push: { eventos_pendentes: evento },
      },
      { new: true }
    );
    if (atualizado) {
      notificarOutbox();
      return atualizado;
    }
    // Outra requisicao alterou o produto no meio do caminho: tenta de novo.
  }
  throw new ErroHttp(409, "Produto alterado simultaneamente, tente novamente");
}

router.get("/produtos/health", (req, res) => {
  res.json({ status: "ok", service: "catalogo" });
});

// Listar (por padrao so os ativos). Filtros: ?categoria=...&incluir_inativos=true
router.get("/produtos", async (req, res) => {
  try {
    const filtro = {};
    if (req.query.incluir_inativos !== "true") filtro.ativo = true;
    if (req.query.categoria) filtro.categoria = String(req.query.categoria);
    const lista = await Produto.find(filtro).sort({ nome: 1 });
    res.json(lista);
  } catch (err) {
    tratarErro(res, err);
  }
});

router.get("/produtos/:id", async (req, res) => {
  try {
    const produto = mongoose.isValidObjectId(req.params.id)
      ? await Produto.findById(req.params.id)
      : null;
    if (!produto) throw new ErroHttp(404, "Produto nao encontrado");
    res.json(produto);
  } catch (err) {
    tratarErro(res, err);
  }
});

// Cadastrar. "estoque_inicial" NAO e guardado aqui (o saldo pertence ao
// servico de Estoque): ele so viaja no evento produto.criado.
router.post("/produtos", async (req, res) => {
  try {
    const campos = selecionarCampos(req.body);
    const estoqueInicial = req.body?.estoque_inicial ?? 0;
    if (!Number.isInteger(estoqueInicial) || estoqueInicial < 0) {
      throw new ErroHttp(400, "estoque_inicial deve ser um inteiro >= 0");
    }

    const produto = new Produto(campos);
    produto.eventos_pendentes.push(
      novoEvento("produto.criado", produto.versao, {
        ...dadosReplicados(produto),
        estoque_inicial: estoqueInicial,
      })
    );
    await produto.save(); // produto + evento gravados atomicamente
    notificarOutbox();

    res.status(201).json(produto);
  } catch (err) {
    tratarErro(res, err);
  }
});

// Editar (parcial). Publica produto.atualizado com o estado completo.
router.put("/produtos/:id", async (req, res) => {
  try {
    const campos = selecionarCampos(req.body);
    if (Object.keys(campos).length === 0) {
      throw new ErroHttp(400, `informe ao menos um campo: ${CAMPOS_EDITAVEIS.join(", ")}`);
    }

    const produto = await alterarComEvento(req.params.id, async (atual) => {
      const antes = atual.toObject();
      atual.set(campos); // aplica conversoes (trim, numeros...)
      await atual.validate();

      const alterados = Object.keys(campos).filter(
        (c) => JSON.stringify(antes[c]) !== JSON.stringify(atual[c])
      );
      if (alterados.length === 0) return null;

      const set = {};
      for (const c of alterados) set[c] = atual[c];
      return {
        tipo: "produto.atualizado",
        set,
        dados: { ...dadosReplicados(atual), campos_alterados: alterados },
      };
    });

    res.json(produto);
  } catch (err) {
    tratarErro(res, err);
  }
});

// Remover (logicamente): o produto fica inativo e o Estoque e avisado.
router.delete("/produtos/:id", async (req, res) => {
  try {
    await alterarComEvento(req.params.id, async (atual) => ({
      tipo: "produto.removido",
      set: { ativo: false },
      dados: { produto_id: String(atual._id) },
    }));
    res.status(204).send();
  } catch (err) {
    tratarErro(res, err);
  }
});
