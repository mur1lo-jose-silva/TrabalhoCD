// Cliente HTTP. Todas as chamadas vao para o MESMO endereco da pagina; o
// Traefik decide qual microsservico responde pelo prefixo do caminho:
//   /produtos -> Catalogo    /estoque -> Estoque    /alertas -> Alertas

export class ErroApi extends Error {
  constructor(status, mensagem, dados) {
    super(mensagem);
    this.status = status;
    this.dados = dados;
  }
}

async function chamar(metodo, url, corpo) {
  let resposta;
  try {
    resposta = await fetch(url, {
      method: metodo,
      headers: corpo !== undefined ? { "Content-Type": "application/json" } : {},
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
  } catch {
    throw new ErroApi(0, "Sem conexao com o servidor");
  }

  const texto = await resposta.text();
  let dados = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = null;
  }

  if (!resposta.ok) {
    const mensagem =
      dados?.erro ||
      (resposta.status === 502 || resposta.status === 503
        ? "Servico indisponivel no momento"
        : `Erro ${resposta.status}`);
    throw new ErroApi(resposta.status, mensagem, dados);
  }
  return dados;
}

const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const api = {
  // Catalogo
  listarProdutos: () => chamar("GET", "/produtos"),
  obterProduto: (id) => chamar("GET", `/produtos/${id}`),
  criarProduto: (dados) => chamar("POST", "/produtos", dados),
  atualizarProduto: (id, dados) => chamar("PUT", `/produtos/${id}`, dados),
  removerProduto: (id) => chamar("DELETE", `/produtos/${id}`),

  // Estoque
  listarSaldos: () => chamar("GET", "/estoque/saldos"),
  listarMovimentacoes: (produtoId) =>
    chamar("GET", `/estoque/movimentacoes${qs({ produto_id: produtoId, limite: 200 })}`),
  criarMovimentacao: (dados) => chamar("POST", "/estoque/movimentacoes", dados),
  estornar: (id, observacao) =>
    chamar("POST", `/estoque/movimentacoes/${id}/estorno`, { observacao: observacao || null }),

  // Alertas
  listarAlertas: (status, limite = 100) => chamar("GET", `/alertas${qs({ status, limite })}`),
};

export const formatar = {
  moeda: (v) =>
    Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
  dataHora: (v) =>
    v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" }) : "—",
};
