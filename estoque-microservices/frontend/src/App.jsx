import { Toasts } from "./componentes/ui.jsx";
import { useAlertasAoVivo, useRota, useToasts } from "./hooks.js";
import Alertas from "./paginas/Alertas.jsx";
import Movimentacoes from "./paginas/Movimentacoes.jsx";
import ProdutoForm from "./paginas/ProdutoForm.jsx";
import Produtos from "./paginas/Produtos.jsx";

const host = window.location.hostname;
const FERRAMENTAS = [
  ["Grafana", `http://${host}:3001`],
  ["RabbitMQ", `http://${host}:15672`],
  ["Prometheus", `http://${host}:9090`],
  ["Traefik", `http://${host}:8080`],
];

export default function App() {
  const rota = useRota();
  const { toasts, mostrar, remover } = useToasts();
  const alertas = useAlertasAoVivo((acao, alerta) => {
    if (acao === "ABERTO") {
      mostrar("alerta", "Estoque baixo", `${alerta.nome}: ${alerta.saldo} un. (minimo ${alerta.estoque_minimo})`);
    } else if (acao === "RESOLVIDO") {
      mostrar("sucesso", "Alerta resolvido", `${alerta.nome} voltou a ${alerta.saldo} un.`);
    } else if (acao === "ENCERRADO") {
      mostrar("info", "Alerta encerrado", `${alerta.nome} foi removido do catálogo.`);
    }
  });

  const [secao, sub] = rota.partes;
  let pagina;
  if (secao === "produtos" && sub === "novo") {
    pagina = <ProdutoForm mostrar={mostrar} />;
  } else if (secao === "produtos" && sub) {
    pagina = <ProdutoForm id={sub} mostrar={mostrar} />;
  } else if (secao === "movimentacoes") {
    pagina = <Movimentacoes produtoInicial={rota.params.produto} mostrar={mostrar} versaoAlertas={alertas.versao} />;
  } else if (secao === "alertas") {
    pagina = <Alertas ativos={alertas.ativos} conectado={alertas.conectado} versao={alertas.versao} />;
  } else {
    pagina = <Produtos mostrar={mostrar} versaoAlertas={alertas.versao} />;
  }

  const link = (destino, texto, extra) => (
    <a href={`#/${destino}`} className={secao === destino ? "ativo" : ""}>
      {texto}
      {extra}
    </a>
  );

  return (
    <>
      <header className="topo">
        <div className="topo-conteudo">
          <a href="#/produtos" className="marca">
            <span className="marca-icone" aria-hidden="true" />
            Estoque
          </a>
          <nav>
            {link("produtos", "Produtos")}
            {link("movimentacoes", "Movimentações")}
            {link(
              "alertas",
              "Alertas",
              alertas.ativos.length > 0 && <span className="contador">{alertas.ativos.length}</span>
            )}
          </nav>
          <span
            className={`ao-vivo ${alertas.conectado ? "on" : "off"}`}
            title={alertas.conectado ? "Recebendo alertas em tempo real (SSE)" : "Servico de alertas indisponivel, tentando reconectar"}
          >
            {alertas.conectado ? "ao vivo" : "reconectando"}
          </span>
        </div>
      </header>

      <main className="conteudo">{pagina}</main>

      <footer className="rodape">
        <span>Ferramentas:</span>
        {FERRAMENTAS.map(([nome, url]) => (
          <a key={nome} href={url} target="_blank" rel="noreferrer">
            {nome}
          </a>
        ))}
      </footer>

      <Toasts toasts={toasts} aoFechar={remover} />
    </>
  );
}
