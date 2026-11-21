import { clientesSse } from "./metricas.js";

// Server-Sent Events: o servidor EMPURRA cada mudanca de alerta para as telas
// conectadas, sem a tela precisar ficar consultando (polling).

const clientes = new Set();
const HEARTBEAT_MS = 15000;

export function registrarCliente(req, res) {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write("retry: 3000\n\n"); // o navegador reconecta sozinho apos 3s
  res.write(`event: conectado\ndata: {}\n\n`);

  clientes.add(res);
  clientesSse.set(clientes.size);

  // Comentario periodico para a conexao nao ser encerrada por inatividade.
  const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);

  req.on("close", () => {
    clearInterval(heartbeat);
    clientes.delete(res);
    clientesSse.set(clientes.size);
  });
}

export function transmitir(evento, dados) {
  const mensagem = `event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`;
  for (const res of clientes) res.write(mensagem);
}
