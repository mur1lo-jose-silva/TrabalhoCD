import amqp from "amqplib";

// Conexao com o RabbitMQ e publicacao na exchange de eventos.
// O produtor declara APENAS a exchange: ele nao sabe quais filas (servicos)
// estao interessadas nos eventos. Esse e o desacoplamento do pub/sub.

const RABBITMQ_URL =
  process.env.RABBITMQ_URL || "amqp://guest:guest@rabbitmq:5672/";
export const EXCHANGE = process.env.EVENTS_EXCHANGE || "estoque.eventos";
const TIMEOUT_CONFIRMACAO_MS = 5000;

let canal = null;
let conectando = false;
let aoConectar = () => {};

export function rabbitDisponivel() {
  return canal !== null;
}

// Mantem a conexao viva para sempre: tenta de novo se cair ou se o broker
// ainda nao estiver pronto. Enquanto estiver fora, os eventos ficam no outbox.
export async function conectarRabbit(callback) {
  if (callback) aoConectar = callback;
  if (conectando) return;
  conectando = true;

  while (!canal) {
    try {
      const conexao = await amqp.connect(RABBITMQ_URL);
      // Canal com "publisher confirms": o broker avisa quando gravou a mensagem.
      const novoCanal = await conexao.createConfirmChannel();
      await novoCanal.assertExchange(EXCHANGE, "topic", { durable: true });

      conexao.on("error", (err) =>
        console.log("[rabbit] erro na conexao:", err.message)
      );
      conexao.on("close", () => {
        console.log("[rabbit] conexao fechada, reconectando...");
        canal = null;
        setTimeout(() => conectarRabbit(), 3000);
      });

      canal = novoCanal;
      console.log(`[rabbit] conectado, exchange "${EXCHANGE}" pronta`);
    } catch (err) {
      console.log("[rabbit] indisponivel, nova tentativa em 3s");
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  conectando = false;
  aoConectar();
}

// Publica um evento e so resolve depois que o broker CONFIRMAR o recebimento.
export function publicar(evento) {
  const ch = canal;
  if (!ch) return Promise.reject(new Error("canal do RabbitMQ indisponivel"));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timeout aguardando confirmacao do broker")),
      TIMEOUT_CONFIRMACAO_MS
    );
    ch.publish(
      EXCHANGE,
      evento.tipo, // routing key = tipo do evento
      Buffer.from(JSON.stringify(evento)),
      {
        persistent: true,
        contentType: "application/json",
        messageId: evento.event_id,
        type: evento.tipo,
      },
      (err) => {
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      }
    );
  });
}
