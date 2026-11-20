// Regra de negocio do Alertas, isolada para ser testada sem banco nem broker.
//
// Um alerta e aberto quando o saldo CRUZA para baixo do minimo e resolvido
// quando volta ao minimo ou acima. Enquanto continua abaixo, o mesmo alerta
// e apenas atualizado: dez vendas seguidas nao geram dez alertas.

export const ACOES = Object.freeze({
  ABRIR: "ABRIR",
  ATUALIZAR: "ATUALIZAR",
  RESOLVER: "RESOLVER",
  NADA: "NADA",
});

export function estaAbaixoDoMinimo(saldo, minimo) {
  return saldo < minimo;
}

export function avaliar({ saldo_atual, estoque_minimo }, existeAlertaAtivo) {
  const abaixo = estaAbaixoDoMinimo(saldo_atual, estoque_minimo);
  if (abaixo && !existeAlertaAtivo) return ACOES.ABRIR;
  if (abaixo && existeAlertaAtivo) return ACOES.ATUALIZAR;
  if (!abaixo && existeAlertaAtivo) return ACOES.RESOLVER;
  return ACOES.NADA;
}

// Valida o envelope de estoque.atualizado (ver docs/eventos.md).
export function validarEvento(evento) {
  if (!evento || typeof evento !== "object") throw new Error("evento nao e um objeto");
  const { event_id, tipo, versao, dados } = evento;
  if (!event_id) throw new Error("event_id ausente");
  if (tipo !== "estoque.atualizado") throw new Error(`tipo inesperado: ${tipo}`);
  if (!Number.isInteger(versao)) throw new Error("versao invalida");
  if (!dados || typeof dados !== "object") throw new Error("dados ausentes");
  if (!dados.produto_id) throw new Error("dados.produto_id ausente");
  for (const campo of ["saldo_atual", "estoque_minimo"]) {
    if (!Number.isInteger(dados[campo])) throw new Error(`dados.${campo} invalido`);
  }
  return evento;
}
