import { randomUUID } from "node:crypto";

import { Produto } from "./model.js";
import { publicar, rabbitDisponivel } from "./eventos.js";
import { eventosPendentes, eventosPublicados } from "./metricas.js";

// Padrao Outbox: o evento e gravado junto com a mudanca do produto (mesma
// operacao atomica no MongoDB) e este "relay" o publica depois. Assim, se o
// RabbitMQ estiver fora, nenhum evento se perde: ele fica pendente no banco.

const ORIGEM = "catalogo-service";
const INTERVALO_MS = Number(process.env.OUTBOX_INTERVALO_MS || 2000);

export function novoEvento(tipo, versao, dados) {
  return {
    event_id: randomUUID(),
    tipo,
    versao,
    ocorrido_em: new Date(),
    origem: ORIGEM,
    dados,
  };
}

function envelope(ev) {
  return {
    event_id: ev.event_id,
    tipo: ev.tipo,
    versao: ev.versao,
    ocorrido_em: new Date(ev.ocorrido_em).toISOString(),
    origem: ev.origem,
    dados: ev.dados,
  };
}

let rodando = false;
let pedidoPendente = false;

// Publica todos os eventos pendentes, na ordem em que foram gerados por produto.
export async function publicarPendentes() {
  if (rodando) {
    pedidoPendente = true; // roda de novo assim que a execucao atual terminar
    return;
  }
  rodando = true;
  try {
    do {
      pedidoPendente = false;
      const docs = await Produto.find({ "eventos_pendentes.0": { $exists: true } })
        .select("_id eventos_pendentes")
        .lean();

      eventosPendentes.set(
        docs.reduce((total, d) => total + d.eventos_pendentes.length, 0)
      );
      if (!rabbitDisponivel()) return;

      for (const doc of docs) {
        for (const ev of doc.eventos_pendentes) {
          try {
            await publicar(envelope(ev));
          } catch (err) {
            eventosPublicados.inc({ tipo: ev.tipo, resultado: "falha" });
            console.log(`[outbox] falha ao publicar ${ev.tipo}: ${err.message}`);
            break; // preserva a ordem: tenta este produto de novo depois
          }
          // Se o servico cair entre publicar e remover, o evento sera publicado
          // de novo. Por isso os consumidores precisam ser idempotentes.
          await Produto.updateOne(
            { _id: doc._id },
            { $pull: { eventos_pendentes: { event_id: ev.event_id } } }
          );
          eventosPublicados.inc({ tipo: ev.tipo, resultado: "ok" });
          eventosPendentes.dec();
          console.log(
            `[outbox] publicado ${ev.tipo} (produto ${doc._id}, versao ${ev.versao})`
          );
        }
      }
    } while (pedidoPendente);
  } finally {
    rodando = false;
  }
}

// Dispara uma publicacao sem bloquear a resposta HTTP.
export function notificarOutbox() {
  publicarPendentes().catch((err) =>
    console.log("[outbox] erro:", err.message)
  );
}

export function iniciarOutbox() {
  setInterval(notificarOutbox, INTERVALO_MS);
  notificarOutbox();
}
