import { useCallback, useEffect, useMemo, useState } from "react";

import { api, formatar } from "../api.js";
import { Aviso, Badge, Cabecalho, Vazio } from "../componentes/ui.jsx";
import { navegar, useIntervalo } from "../hooks.js";

const ORIGENS = {
  API: "manual",
  ESTOQUE_INICIAL: "estoque inicial",
  ESTORNO: "estorno",
};

export default function Movimentacoes({ produtoInicial, mostrar, versaoAlertas }) {
  const [saldos, setSaldos] = useState([]);
  const [historico, setHistorico] = useState(null);
  const [erroLista, setErroLista] = useState("");
  const [filtroProduto, setFiltroProduto] = useState(produtoInicial ?? "");

  const [form, setForm] = useState({ produto_id: produtoInicial ?? "", tipo: "SAIDA", quantidade: "1", observacao: "" });
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null); // { tom, texto }

  const carregar = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([api.listarSaldos(), api.listarMovimentacoes(filtroProduto || undefined)]);
      setSaldos(s);
      setHistorico(h);
      setErroLista("");
    } catch (e) {
      setErroLista(e.message);
    }
  }, [filtroProduto]);

  useEffect(() => {
    carregar();
  }, [carregar, versaoAlertas]);
  useIntervalo(carregar, 10000);

  useEffect(() => {
    if (produtoInicial) {
      setFiltroProduto(produtoInicial);
      setForm((f) => ({ ...f, produto_id: produtoInicial }));
    }
  }, [produtoInicial]);

  const nomes = useMemo(() => new Map(saldos.map((s) => [s.produto_id, s])), [saldos]);
  const selecionado = nomes.get(form.produto_id);

  async function registrar(e) {
    e.preventDefault();
    setResultado(null);
    setEnviando(true);
    try {
      const mov = await api.criarMovimentacao({
        produto_id: form.produto_id,
        tipo: form.tipo,
        quantidade: Number(form.quantidade),
        observacao: form.observacao.trim() || null,
      });
      setResultado({
        tom: "ok",
        texto: `${mov.tipo === "ENTRADA" ? "Entrada" : "Saída"} de ${mov.quantidade} un. registrada. Saldo atual: ${mov.saldo_apos}.`,
      });
      setForm((f) => ({ ...f, quantidade: "1", observacao: "" }));
      carregar();
    } catch (e2) {
      const extra =
        e2.dados?.saldo_atual !== undefined ? ` Saldo atual: ${e2.dados.saldo_atual} un.` : "";
      setResultado({ tom: "erro", texto: `${e2.message}.${extra}` });
    } finally {
      setEnviando(false);
    }
  }

  async function estornar(m) {
    const produto = nomes.get(m.produto_id)?.nome ?? m.produto_id;
    if (!window.confirm(`Estornar a movimentação #${m.id} (${m.tipo} de ${m.quantidade} un. de ${produto})?\nSerá criada uma movimentação de tipo oposto.`)) return;
    try {
      const est = await api.estornar(m.id);
      mostrar("sucesso", `Movimentação #${m.id} estornada`, `Criado o estorno #${est.id}. Saldo atual: ${est.saldo_apos}.`);
      carregar();
    } catch (e) {
      mostrar("erro", "Não foi possível estornar", e.message);
    }
  }

  function alterarFiltro(valor) {
    setFiltroProduto(valor);
    navegar(valor ? `/movimentacoes?produto=${valor}` : "/movimentacoes");
  }

  const ativos = saldos.filter((s) => s.ativo);

  return (
    <>
      <Cabecalho
        titulo="Movimentações"
        descricao="Entradas e saídas validadas na hora pelo serviço de Estoque. O histórico não é editado: correções são feitas por estorno."
      />

      <form className="cartao formulario-mov" onSubmit={registrar}>
        <label className="largo">
          Produto
          <select
            required
            value={form.produto_id}
            onChange={(e) => setForm((f) => ({ ...f, produto_id: e.target.value }))}
          >
            <option value="">Selecione…</option>
            {ativos.map((s) => (
              <option key={s.produto_id} value={s.produto_id}>
                {s.nome} ({s.sku}) — saldo {s.saldo}
              </option>
            ))}
          </select>
        </label>
        <div className="tipo" role="radiogroup" aria-label="Tipo">
          {["ENTRADA", "SAIDA"].map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={form.tipo === t}
              className={`btn ${form.tipo === t ? (t === "ENTRADA" ? "btn-entrada" : "btn-saida") : ""}`}
              onClick={() => setForm((f) => ({ ...f, tipo: t }))}
            >
              {t === "ENTRADA" ? "Entrada" : "Saída"}
            </button>
          ))}
        </div>
        <label>
          Quantidade
          <input
            type="number"
            min="1"
            step="1"
            required
            value={form.quantidade}
            onChange={(e) => setForm((f) => ({ ...f, quantidade: e.target.value }))}
          />
        </label>
        <label className="largo">
          Observação
          <input
            value={form.observacao}
            placeholder={form.tipo === "ENTRADA" ? "Ex.: Recebimento do fornecedor" : "Ex.: Venda balcão"}
            onChange={(e) => setForm((f) => ({ ...f, observacao: e.target.value }))}
          />
        </label>
        <button type="submit" className="btn btn-primario" disabled={enviando || !form.produto_id}>
          {enviando ? "Registrando…" : "Registrar"}
        </button>
        {selecionado && (
          <p className="ajuda largo-total">
            Saldo atual de <strong>{selecionado.nome}</strong>: {selecionado.saldo} un. · mínimo {selecionado.estoque_minimo}
          </p>
        )}
      </form>

      {resultado && (
        <Aviso tom={resultado.tom === "ok" ? "ok" : "erro"} aoFechar={() => setResultado(null)}>
          {resultado.texto}
        </Aviso>
      )}

      <div className="barra-filtro">
        <h2>Histórico</h2>
        <select value={filtroProduto} onChange={(e) => alterarFiltro(e.target.value)} aria-label="Filtrar por produto">
          <option value="">Todos os produtos</option>
          {saldos.map((s) => (
            <option key={s.produto_id} value={s.produto_id}>
              {s.nome} ({s.sku}){s.ativo ? "" : " — removido"}
            </option>
          ))}
        </select>
      </div>

      {erroLista && <Aviso>Serviço de Estoque indisponível: {erroLista}</Aviso>}

      {historico === null ? (
        <Vazio>Carregando…</Vazio>
      ) : historico.length === 0 ? (
        <Vazio>Nenhuma movimentação registrada.</Vazio>
      ) : (
        <div className="tabela-wrap">
          <table>
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Data</th>
                <th>Produto</th>
                <th>Tipo</th>
                <th className="num">Qtd.</th>
                <th className="num">Saldo após</th>
                <th>Origem</th>
                <th>Observação</th>
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {historico.map((m) => (
                <tr key={m.id} className={m.estornada_por ? "estornada" : ""}>
                  <td className="num sub">{m.id}</td>
                  <td className="sub">{formatar.dataHora(m.criado_em)}</td>
                  <td>{nomes.get(m.produto_id)?.nome ?? m.produto_id}</td>
                  <td>
                    <Badge tom={m.tipo === "ENTRADA" ? "ok" : "saida"}>{m.tipo === "ENTRADA" ? "entrada" : "saída"}</Badge>
                  </td>
                  <td className="num forte">{m.quantidade}</td>
                  <td className="num">{m.saldo_apos}</td>
                  <td className="sub">
                    {ORIGENS[m.origem] ?? m.origem}
                    {m.estorno_de && ` de #${m.estorno_de}`}
                  </td>
                  <td>{m.observacao || "—"}</td>
                  <td className="acoes-linha">
                    {m.estornada_por ? (
                      <span className="sub">estornada por #{m.estornada_por}</span>
                    ) : m.origem !== "ESTORNO" ? (
                      <button className="btn btn-pequeno" onClick={() => estornar(m)}>
                        Estornar
                      </button>
                    ) : null}
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
