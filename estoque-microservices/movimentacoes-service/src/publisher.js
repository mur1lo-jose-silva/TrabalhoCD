import amqp from "amqplib";

const RABBITMQ_URL =
  process.env.RABBITMQ_URL || "amqp://guest:guest@rabbitmq:5672/";
const QUEUE = process.env.MOVIMENTACOES_QUEUE || "movimentacoes.estoque";

let channel = null;

export async function conectarRabbit() {
  for (let tentativa = 1; tentativa <= 10; tentativa++) {
    try {
      const connection = await amqp.connect(RABBITMQ_URL);
      channel = await connection.createChannel();
      await channel.assertQueue(QUEUE, { durable: true });
      console.log("[rabbit] conectado e fila pronta");
      return;
    } catch (err) {
      console.log(
        `[rabbit] falha ao conectar (tentativa ${tentativa}), nova tentativa em 3s`
      );
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error("Nao foi possivel conectar ao RabbitMQ");
}

export function publicarMovimentacao(evento) {
  if (!channel) {
    console.warn("[rabbit] canal indisponivel, evento nao publicado");
    return;
  }
  channel.sendToQueue(QUEUE, Buffer.from(JSON.stringify(evento)), {
    persistent: true,
  });
  console.log("[rabbit] evento publicado:", evento);
}
