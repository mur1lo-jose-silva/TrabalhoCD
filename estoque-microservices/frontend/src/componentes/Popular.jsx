import { useState } from "react";

import { api } from "../api.js";
import { gerarProdutos } from "../gerador.js";

const LIMITE = 500; // teto de seguranca para nao inundar o catalogo
const CONCORRENCIA = 6; // POSTs em paralelo ao criar o lote

// Botao "Popular" + modal para gerar produtos ficticios de teste.
// A quantidade e configuravel (1..LIMITE). Mostra o progresso e, ao final,
// avisa quantos foram criados e chama `aoConcluir` para recarregar a lista.
export default function Popular({ mostrar, aoConcluir }) {
  const [aberto, setAberto] = useState(false);
  const [quantidade, setQuantidade] = useState("100");
  const [executando, setExecutando] = useState(false);
  const [feitos, setFeitos] = useState(0);
  const [total, setTotal] = useState(0);

  function abrir() {
    setFeitos(0);
    setTotal(0);
    setAberto(true);
  }

  function fechar() {
    if (executando) return; // nao fecha no meio da geracao
    setAberto(false);
  }

  async function gerar(e) {
    e.preventDefault();
    const n = Math.floor(Number(quantidade));
    if (!Number.isFinite(n) || n < 1) {
      mostrar("erro", "Quantidade inválida", "Informe um número inteiro de 1 em diante.");
      return;
    }
    if (n > LIMITE) {
      mostrar("erro", "Quantidade muito alta", `Gere no máximo ${LIMITE} itens por vez.`);
      return;
    }

    const itens = gerarProdutos(n);
    setExecutando(true);
    setTotal(itens.length);
    setFeitos(0);

    let sucesso = 0;
    let falhas = 0;
    let concluidos = 0;
    let idx = 0;

    const worker = async () => {
      while (idx < itens.length) {
        const atual = itens[idx++];
        try {
          await api.criarProduto(atual);
          sucesso++;
        } catch {
          falhas++;
        }
        concluidos++;
        setFeitos(concluidos);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCORRENCIA, itens.length) }, worker)
    );

    setExecutando(false);
    setAberto(false);
    mostrar(
      falhas ? "alerta" : "sucesso",
      "População concluída",
      falhas
        ? `${sucesso} produto(s) criado(s), ${falhas} falharam.`
        : `${sucesso} produto(s) criado(s). O Estoque vai registrar as entradas iniciais.`
    );
    aoConcluir?.();
  }

  const pct = total ? Math.round((feitos / total) * 100) : 0;

  return (
    <>
      <button className="btn" onClick={abrir}>
        Popular
      </button>

      {aberto && (
        <div className="modal-fundo" role="dialog" aria-modal="true" aria-label="Popular catálogo" onClick={fechar}>
          <form className="cartao modal-caixa" onClick={(e) => e.stopPropagation()} onSubmit={gerar}>
            <h2 style={{ marginTop: 0 }}>Popular catálogo</h2>
            <p className="ajuda">
              Gera produtos fictícios com categoria, preço e estoque aleatórios — útil para
              testar a tela, os saldos e os alertas sem cadastrar um a um.
            </p>

            <label>
              Quantidade de itens
              <input
                type="number"
                min="1"
                max={LIMITE}
                step="1"
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                disabled={executando}
                autoFocus
              />
            </label>

            {executando && (
              <div className="progresso" aria-live="polite">
                <div className="progresso-barra">
                  <span style={{ width: `${pct}%` }} />
                </div>
                <span className="ajuda" style={{ margin: 0 }}>
                  Criando {feitos} de {total}…
                </span>
              </div>
            )}

            <div className="rodape-form">
              <button type="button" className="btn" onClick={fechar} disabled={executando}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primario" disabled={executando}>
                {executando ? "Gerando…" : "Gerar itens"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
