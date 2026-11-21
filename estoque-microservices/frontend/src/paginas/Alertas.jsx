import { useEffect, useState } from "react";

import { api, formatar } from "../api.js";
import { Aviso, Badge, Cabecalho, Vazio } from "../componentes/ui.jsx";
import { navegar } from "../hooks.js";

export default function Alertas({ ativos, conectado, versao }) {
  const [resolvidos, setResolvidos] = useState(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    api
      .listarAlertas("RESOLVIDO,ENCERRADO", 50)
      .then((r) => {
        setResolvidos(r);
        setErro("");
      })
      .catch((e) => setErro(e.message));
  }, [versao, conectado]);

  return (
    <>
      <Cabecalho
        titulo="Alertas de estoque baixo"
        descricao="Atualizados em tempo real: o serviço de Alertas consome os eventos estoque.atualizado e empurra cada mudança para esta tela (Server-Sent Events)."
      >
        <span className={`ao-vivo ${conectado ? "on" : "off"}`}>{conectado ? "ao vivo" : "reconectando"}</span>
      </Cabecalho>

      {!conectado && (
        <Aviso tom="aviso">
          Serviço de Alertas indisponível. Os eventos continuam guardados na fila do RabbitMQ e serão
          processados quando ele voltar; esta tela reconecta sozinha.
        </Aviso>
      )}

      <h2>Ativos ({ativos.length})</h2>
      {ativos.length === 0 ? (
        <Vazio>Nenhum produto abaixo do estoque mínimo.</Vazio>
      ) : (
        <div className="cartoes-alerta">
          {ativos.map((a) => (
            <div key={a.id} className="cartao alerta-ativo">
              <div className="alerta-topo">
                <div>
                  <div className="nome">{a.nome}</div>
                  <div className="sub">{a.sku}</div>
                </div>
                <Badge tom="alerta">abaixo do mínimo</Badge>
              </div>
              <div className="alerta-numeros">
                <div>
                  <span className="grande">{a.saldo}</span>
                  <span className="sub">saldo</span>
                </div>
                <div>
                  <span className="grande">{a.estoque_minimo}</span>
                  <span className="sub">mínimo</span>
                </div>
                <div>
                  <span className="grande">{Math.max(a.estoque_minimo - a.saldo, 0)}</span>
                  <span className="sub">faltam</span>
                </div>
              </div>
              <div className="alerta-rodape">
                <span className="sub">Aberto em {formatar.dataHora(a.aberto_em)}</span>
                <button className="btn btn-pequeno btn-primario" onClick={() => navegar(`/movimentacoes?produto=${a.produto_id}`)}>
                  Repor
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2>Fechados recentemente</h2>
      {erro && <Aviso>Não foi possível carregar o histórico: {erro}</Aviso>}
      {resolvidos === null ? (
        !erro && <Vazio>Carregando…</Vazio>
      ) : resolvidos.length === 0 ? (
        <Vazio>Nenhum alerta fechado ainda.</Vazio>
      ) : (
        <div className="tabela-wrap">
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th className="num">Saldo final</th>
                <th className="num">Mínimo</th>
                <th>Motivo</th>
                <th>Aberto em</th>
                <th>Fechado em</th>
              </tr>
            </thead>
            <tbody>
              {resolvidos.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div className="nome">{a.nome}</div>
                    <div className="sub">{a.sku}</div>
                  </td>
                  <td className="num">{a.saldo}</td>
                  <td className="num">{a.estoque_minimo}</td>
                  <td>
                    {a.status === "ENCERRADO" ? (
                      <Badge titulo="O produto foi removido do catálogo">produto removido</Badge>
                    ) : (
                      <Badge tom="ok">estoque reposto</Badge>
                    )}
                  </td>
                  <td className="sub">{formatar.dataHora(a.aberto_em)}</td>
                  <td className="sub">{formatar.dataHora(a.resolvido_em)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
