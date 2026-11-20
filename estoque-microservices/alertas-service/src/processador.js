import { Alerta, EstadoProduto } from "./model.js";
import { alertasAcoes, alertasAtivos } from "./metricas.js";
import { ACOES, avaliar, validarEvento } from "./regras.js";
import { transmitir } from "./sse.js";

// Aplica um evento estoque.atualizado.
//
// Idempotencia SEM transacao (o MongoDB sem replica set nao tem transacao
// entre documentos):
//  1. eventos com versao <= a ultima aplicada sao ignorados;
//  2. as acoes sobre o alerta dependem do ESTADO atual (abrir so se nao ha
//     alerta ativo, resolver so se ha), entao repeti-las nao tem efeito duplo;
//  3. a versao e gravada por ultimo. Se o servico cair antes disso, o evento
//     e reentregue e reaplicado sem problema, pelo item 2.

const NOME_ACAO = {
  [ACOES.ABRIR]: "ABERTO",
  [ACOES.ATUALIZAR]: "ATUALIZADO",
  [ACOES.RESOLVER]: "RESOLVIDO",
};

export async function atualizarGaugeAtivos() {
  alertasAtivos.set(await Alerta.countDocuments({ status: "ATIVO" }));
}

export async function aplicarEvento(evento) {
  const { event_id, versao, dados } = validarEvento(evento);
  const produtoId = String(dados.produto_id);

  const estado = await EstadoProduto.findById(produtoId).lean();
  if (estado && versao <= estado.versao) return { resultado: "ignorado" };

  const ativo = await Alerta.findOne({ produto_id: produtoId, status: "ATIVO" });
  let acao = avaliar(dados, Boolean(ativo));
  const snapshot = {
    nome: dados.nome,
    sku: dados.sku,
    saldo: dados.saldo_atual,
    estoque_minimo: dados.estoque_minimo,
    ultimo_evento: event_id,
  };

  let alerta = null;
  if (acao === ACOES.ABRIR) {
    try {
      alerta = await Alerta.create({
        produto_id: produtoId,
        ...snapshot,
        status: "ATIVO",
        aberto_por_evento: event_id,
      });
    } catch (err) {
      if (err?.code !== 11000) throw err;
      // O indice unico impediu um segundo alerta ativo: apenas atualiza.
      acao = ACOES.ATUALIZAR;
      alerta = await Alerta.findOneAndUpdate(
        { produto_id: produtoId, status: "ATIVO" },
        { $set: snapshot },
        { new: true }
      );
    }
  } else if (acao === ACOES.ATUALIZAR) {
    alerta = await Alerta.findOneAndUpdate(
      { _id: ativo._id, status: "ATIVO" },
      { $set: snapshot },
      { new: true }
    );
  } else if (acao === ACOES.RESOLVER) {
    alerta = await Alerta.findOneAndUpdate(
      { _id: ativo._id, status: "ATIVO" },
      { $set: { ...snapshot, status: "RESOLVIDO", resolvido_em: new Date() } },
      { new: true }
    );
  }

  // Grava a versao aplicada por ultimo (so avanca, nunca volta).
  try {
    await EstadoProduto.updateOne(
      { _id: produtoId, versao: { $lt: versao } },
      { $set: { versao } },
      { upsert: true }
    );
  } catch (err) {
    if (err?.code !== 11000) throw err; // versao maior ja gravada: tudo certo
  }

  if (acao !== ACOES.NADA && alerta) {
    alertasAcoes.inc({ acao: NOME_ACAO[acao] });
    await atualizarGaugeAtivos();
    transmitir("alerta", { acao: NOME_ACAO[acao], alerta: alerta.toJSON() });
  }
  return { resultado: "aplicado", acao };
}
