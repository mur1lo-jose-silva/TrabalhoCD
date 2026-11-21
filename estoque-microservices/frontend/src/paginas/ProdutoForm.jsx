import { useEffect, useState } from "react";

import { api } from "../api.js";
import { Aviso, Cabecalho, Vazio } from "../componentes/ui.jsx";
import { navegar } from "../hooks.js";

const VAZIO = {
  nome: "",
  sku: "",
  categoria: "",
  preco: "0",
  estoque_minimo: "0",
  estoque_inicial: "0",
};

let proximaChave = 0;
const linhaAtributo = (chave = "", valor = "") => ({ id: proximaChave++, chave, valor });

export default function ProdutoForm({ id, mostrar }) {
  const editando = Boolean(id);
  const [campos, setCampos] = useState(VAZIO);
  const [atributos, setAtributos] = useState([]);
  const [carregando, setCarregando] = useState(editando);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!editando) return;
    api
      .obterProduto(id)
      .then((p) => {
        setCampos({
          nome: p.nome,
          sku: p.sku,
          categoria: p.categoria ?? "",
          preco: String(p.preco ?? 0),
          estoque_minimo: String(p.estoque_minimo ?? 0),
          estoque_inicial: "0",
        });
        setAtributos(Object.entries(p.atributos ?? {}).map(([k, v]) => linhaAtributo(k, String(v))));
      })
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false));
  }, [editando, id]);

  const alterar = (campo) => (e) => setCampos((c) => ({ ...c, [campo]: e.target.value }));

  async function salvar(e) {
    e.preventDefault();
    setErro("");

    const chaves = atributos.map((a) => a.chave.trim()).filter(Boolean);
    if (new Set(chaves).size !== chaves.length) {
      setErro("Há atributos com o mesmo nome.");
      return;
    }

    const dados = {
      nome: campos.nome,
      sku: campos.sku,
      categoria: campos.categoria.trim() || null,
      preco: Number(campos.preco),
      estoque_minimo: Number(campos.estoque_minimo),
      atributos: Object.fromEntries(
        atributos.filter((a) => a.chave.trim()).map((a) => [a.chave.trim(), a.valor])
      ),
    };
    if (!editando) dados.estoque_inicial = Number(campos.estoque_inicial);

    setSalvando(true);
    try {
      if (editando) {
        await api.atualizarProduto(id, dados);
        mostrar("sucesso", "Produto atualizado", dados.nome);
      } else {
        await api.criarProduto(dados);
        mostrar(
          "sucesso",
          "Produto cadastrado",
          dados.estoque_inicial > 0
            ? `O Estoque vai registrar a entrada inicial de ${dados.estoque_inicial} un. ao receber o evento.`
            : dados.nome
        );
      }
      navegar("/produtos");
    } catch (e2) {
      setErro(e2.message);
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) return <Vazio>Carregando…</Vazio>;

  return (
    <>
      <Cabecalho
        titulo={editando ? "Editar produto" : "Novo produto"}
        descricao={
          editando
            ? "O saldo não é editado aqui: ele só muda por movimentações no serviço de Estoque."
            : "O estoque inicial vira uma ENTRADA registrada pelo serviço de Estoque."
        }
      />
      <Aviso aoFechar={erro ? () => setErro("") : undefined}>{erro}</Aviso>

      <form className="cartao formulario" onSubmit={salvar}>
        <div className="grade">
          <label>
            Nome
            <input required value={campos.nome} onChange={alterar("nome")} />
          </label>
          <label>
            SKU
            <input required value={campos.sku} onChange={alterar("sku")} />
          </label>
          <label>
            Categoria
            <input value={campos.categoria} onChange={alterar("categoria")} placeholder="Ex.: Periféricos" />
          </label>
          <label>
            Preço (R$)
            <input type="number" min="0" step="0.01" required value={campos.preco} onChange={alterar("preco")} />
          </label>
          <label>
            Estoque mínimo
            <input type="number" min="0" step="1" required value={campos.estoque_minimo} onChange={alterar("estoque_minimo")} />
          </label>
          {!editando && (
            <label>
              Estoque inicial
              <input type="number" min="0" step="1" required value={campos.estoque_inicial} onChange={alterar("estoque_inicial")} />
            </label>
          )}
        </div>

        <fieldset>
          <legend>Atributos da categoria</legend>
          <p className="ajuda">
            Campos livres por produto (ex.: switch, voltagem, resolução). É aqui que o banco de
            documentos do Catálogo se justifica: cada produto pode ter atributos diferentes.
          </p>
          {atributos.map((a) => (
            <div key={a.id} className="linha-atributo">
              <input
                placeholder="Atributo"
                value={a.chave}
                aria-label="Nome do atributo"
                onChange={(e) =>
                  setAtributos((l) => l.map((x) => (x.id === a.id ? { ...x, chave: e.target.value } : x)))
                }
              />
              <input
                placeholder="Valor"
                value={a.valor}
                aria-label="Valor do atributo"
                onChange={(e) =>
                  setAtributos((l) => l.map((x) => (x.id === a.id ? { ...x, valor: e.target.value } : x)))
                }
              />
              <button
                type="button"
                className="btn btn-pequeno"
                onClick={() => setAtributos((l) => l.filter((x) => x.id !== a.id))}
                aria-label="Remover atributo"
              >
                Remover
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-pequeno" onClick={() => setAtributos((l) => [...l, linhaAtributo()])}>
            + Adicionar atributo
          </button>
        </fieldset>

        <div className="rodape-form">
          <button type="button" className="btn" onClick={() => navegar("/produtos")}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primario" disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </>
  );
}
