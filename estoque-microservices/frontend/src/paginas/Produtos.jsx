import { useCallback, useEffect, useMemo, useState } from "react";

import { api, formatar } from "../api.js";
import { Aviso, Badge, Cabecalho, Vazio } from "../componentes/ui.jsx";
import { navegar, useIntervalo } from "../hooks.js";

// Junta duas fontes independentes:
//  - Catalogo (/produtos): nome, SKU, preco, atributos
//  - Estoque  (/estoque/saldos): saldo e situacao
// Se o Catalogo cair, a tela continua mostrando o estoque com os dados que o
// proprio Estoque replicou (autonomia de dados).

function situacao(item) {
  if (!item.estoque) return <Badge tom="info" titulo="O Estoque ainda nao recebeu o evento produto.criado">sincronizando…</Badge>;
  if (item.estoque.abaixo_minimo) return <Badge tom="alerta">abaixo do mínimo</Badge>;
  return <Badge tom="ok">ok</Badge>;
}

export default function Produtos({ mostrar, versaoAlertas }) {
  const [produtos, setProdutos] = useState(null);
  const [saldos, setSaldos] = useState(null);
  const [erroCatalogo, setErroCatalogo] = useState("");
  const [erroEstoque, setErroEstoque] = useState("");
  const [filtro, setFiltro] = useState("");

  const carregar = useCallback(async () => {
    const [p, s] = await Promise.allSettled([api.listarProdutos(), api.listarSaldos()]);
    if (p.status === "fulfilled") {
      setProdutos(p.value);
      setErroCatalogo("");
    } else setErroCatalogo(p.reason.message);
    if (s.status === "fulfilled") {
      setSaldos(s.value);
      setErroEstoque("");
    } else setErroEstoque(s.reason.message);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar, versaoAlertas]);

  const linhas = useMemo(() => {
    const porId = new Map((saldos ?? []).map((s) => [s.produto_id, s]));
    if (produtos && !erroCatalogo) {
      return produtos.map((p) => ({ ...p, estoque: porId.get(p.id) }));
    }
    // Catalogo fora do ar: monta a lista a partir da copia local do Estoque.
    return (saldos ?? []).map((s) => ({
      id: s.produto_id,
      nome: s.nome,
      sku: s.sku,
      categoria: s.categoria,
      preco: null,
      atributos: {},
      estoque: s,
      soEstoque: true,
    }));
  }, [produtos, saldos, erroCatalogo]);

  const sincronizando = linhas.some((l) => !l.estoque);
  // Enquanto algum produto ainda nao chegou ao Estoque, consulta de novo.
  useIntervalo(carregar, 1500, sincronizando);
  useIntervalo(carregar, 10000);

  const visiveis = linhas.filter((l) =>
    `${l.nome} ${l.sku} ${l.categoria ?? ""}`.toLowerCase().includes(filtro.toLowerCase())
  );

  async function remover(p) {
    if (!window.confirm(`Remover "${p.nome}" do catálogo? O histórico de movimentações é mantido.`)) return;
    try {
      await api.removerProduto(p.id);
      mostrar("sucesso", "Produto removido", `${p.nome} foi removido do catálogo.`);
      carregar();
    } catch (e) {
      mostrar("erro", "Não foi possível remover", e.message);
    }
  }

  const carregando = produtos === null && saldos === null && !erroCatalogo && !erroEstoque;

  return (
    <>
      <Cabecalho titulo="Produtos" descricao="Catálogo de produtos com o saldo atual vindo do serviço de Estoque.">
        <input
          className="busca"
          placeholder="Buscar por nome, SKU ou categoria"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          aria-label="Buscar produtos"
        />
        <button className="btn btn-primario" onClick={() => navegar("/produtos/novo")}>
          Novo produto
        </button>
      </Cabecalho>

      {erroCatalogo && (
        <Aviso tom="aviso">
          Catálogo indisponível ({erroCatalogo}). Mostrando os produtos a partir da cópia local do
          serviço de Estoque: movimentações continuam funcionando.
        </Aviso>
      )}
      {erroEstoque && <Aviso>Serviço de Estoque indisponível: {erroEstoque}</Aviso>}

      {carregando ? (
        <Vazio>Carregando…</Vazio>
      ) : visiveis.length === 0 ? (
        <Vazio>
          {linhas.length === 0 ? "Nenhum produto cadastrado ainda." : "Nenhum produto encontrado na busca."}
        </Vazio>
      ) : (
        <div className="tabela-wrap">
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th>Categoria</th>
                <th className="num">Preço</th>
                <th className="num">Saldo</th>
                <th className="num">Mínimo</th>
                <th>Situação</th>
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {visiveis.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="nome">{p.nome}</div>
                    <div className="sub">{p.sku}</div>
                    {p.atributos && Object.keys(p.atributos).length > 0 && (
                      <div className="chips">
                        {Object.entries(p.atributos).map(([k, v]) => (
                          <span key={k} className="chip">
                            {k}: {String(v)}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>{p.categoria || "—"}</td>
                  <td className="num">{p.preco === null ? "—" : formatar.moeda(p.preco)}</td>
                  <td className="num forte">{p.estoque ? p.estoque.saldo : "—"}</td>
                  <td className="num">{p.estoque?.estoque_minimo ?? p.estoque_minimo ?? "—"}</td>
                  <td>{situacao(p)}</td>
                  <td className="acoes-linha">
                    <button
                      className="btn btn-pequeno"
                      disabled={!p.estoque}
                      onClick={() => navegar(`/movimentacoes?produto=${p.id}`)}
                    >
                      Movimentar
                    </button>
                    {!p.soEstoque && (
                      <>
                        <button className="btn btn-pequeno" onClick={() => navegar(`/produtos/${p.id}`)}>
                          Editar
                        </button>
                        <button className="btn btn-pequeno btn-perigo" onClick={() => remover(p)}>
                          Remover
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
