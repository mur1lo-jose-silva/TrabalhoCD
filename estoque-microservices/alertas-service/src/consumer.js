import amqp from "amqplib";
import mongoose from "mongoose";

import { eventosConsumidos } from "./metricas.js";
import { aplicarEvento } from "./processador.js";

// Consumidor de estoque.atualizado. O Alertas declara a PROPRIA fila e a liga
// a exchange: o Estoque (produtor) nao sabe que este servico existe.

const RABBITMQ_URL =
  process.env.RABBITMQ_URL || "amqp://guest:guest@rabbitmq:5672/";
const EXCHANGE = process.env.EVENTS_EXCHANGE || "estoque.eventos";
const DLX = process.env.EVENTS_DLX || "estoque.dlx";
const FILA = "alertas.estoque";
const FILA_DLQ = `${FILA}.dlq`;
const ROUTING_KEYS = ["estoque.atualizado"];

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`[consumer] ${msg}`);

function erroTemporario(err) {
  return (
    mongoose.connection.readyState !== 1 ||
    ["MongoNetworkError", "MongoServerSelectionError", "MongoNotConnectedError"].includes(
      err?.name
    )
  );
}

async function processar(canal, msg) {
  let evento;
  try {
    evento = JSON.parse(msg.content.toString());
  } catch {
    log("mensagem nao e JSON, enviada para a DLQ");
    eventosConsumidos.inc({ tipo: "desconhecido", resultado: "invalido" });
    canal.nack(msg, false, false);
    return;
  }

  const tipo = String(evento?.tipo ?? "desconhecido");
  try {
    const { resultado, acao } = await aplicarEvento(evento);
    canal.ack(msg); // so confirma depois de gravar no banco
    eventosConsumidos.inc({ tipo, resultado });
    const d = evento.dados;
    log(
      `${tipo} v${evento.versao} ${d.sku ?? d.produto_id}: saldo ${d.saldo_atual}/` +
        `minimo ${d.estoque_minimo} -> ${resultado}${acao ? ` (${acao})` : ""}`
    );
  } catch (err) {
    if (erroTemporario(err)) {
      log(`banco indisponivel, ${tipo} volta para a fila`);
      eventosConsumidos.inc({ tipo, resultado: "reenfileirado" });
      await espera(3000);
      canal.nack(msg, false, true);
      return;
    }
    log(`erro ao processar ${tipo}, enviado para a DLQ: ${err.message}`);
    eventosConsumidos.inc({ tipo, resultado: "invalido" });
    canal.nack(msg, false, false);
  }
}

export async function iniciarConsumidor() {
  for (;;) {
    try {
      const conexao = await amqp.connect(RABBITMQ_URL);
      const canal = await conexao.createChannel();

      await canal.assertExchange(EXCHANGE, "topic", { durable: true });
      await canal.assertExchange(DLX, "topic", { durable: true });
      await canal.assertQueue(FILA_DLQ, { durable: true });
      await canal.bindQueue(FILA_DLQ, DLX, FILA);
      await canal.assertQueue(FILA, {
        durable: true,
        deadLetterExchange: DLX,
        deadLetterRoutingKey: FILA,
      });
      for (const rk of ROUTING_KEYS) await canal.bindQueue(FILA, EXCHANGE, rk);

      await canal.prefetch(1); // um evento por vez, na ordem
      await canal.consume(FILA, (msg) => msg && processar(canal, msg));
      log(`aguardando eventos na fila '${FILA}'`);

      // Fica aqui ate a conexao cair; entao reconecta.
      await new Promise((resolve) => {
        conexao.on("close", resolve);
        conexao.on("error", (err) => log(`erro na conexao: ${err.message}`));
      });
      log("conexao com o RabbitMQ perdida, reconectando...");
    } catch {
      log("RabbitMQ indisponivel, nova tentativa em 5s");
    }
    await espera(5000);
  }
}
