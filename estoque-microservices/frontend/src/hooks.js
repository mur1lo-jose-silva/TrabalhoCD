import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api.js";

// ------------------------------------------------------------ rotas
// Roteamento por hash (#/produtos, #/movimentacoes?produto=...). Assim o
// caminho real da pagina e sempre "/", que o Traefik entrega para a interface,
// sem conflitar com as rotas de API (/produtos, /estoque, /alertas).

function lerHash() {
  const bruto = window.location.hash.replace(/^#/, "") || "/produtos";
  const [caminho, busca = ""] = bruto.split("?");
  return {
    caminho,
    partes: caminho.split("/").filter(Boolean),
    params: Object.fromEntries(new URLSearchParams(busca)),
  };
}

export function useRota() {
  const [rota, setRota] = useState(lerHash);
  useEffect(() => {
    const aoMudar = () => setRota(lerHash());
    window.addEventListener("hashchange", aoMudar);
    return () => window.removeEventListener("hashchange", aoMudar);
  }, []);
  return rota;
}

export function navegar(destino) {
  window.location.hash = destino;
}

// ----------------------------------------------- alertas em tempo real
// Mantem a lista de alertas ATIVOS sincronizada via Server-Sent Events.
// O EventSource do navegador reconecta sozinho se o servico de Alertas cair.

export function useAlertasAoVivo(aoReceber) {
  const [ativos, setAtivos] = useState([]);
  const [conectado, setConectado] = useState(false);
  const [versao, setVersao] = useState(0); // muda a cada evento recebido
  const callback = useRef(aoReceber);
  callback.current = aoReceber;

  const recarregar = useCallback(async () => {
    try {
      setAtivos(await api.listarAlertas("ATIVO"));
    } catch {
      /* servico de alertas fora: mantem a lista atual */
    }
  }, []);

  useEffect(() => {
    const fonte = new EventSource("/alertas/stream");

    fonte.addEventListener("conectado", () => {
      setConectado(true);
      recarregar(); // ao (re)conectar, busca o estado completo
    });
    fonte.addEventListener("alerta", (e) => {
      const { acao, alerta } = JSON.parse(e.data);
      setAtivos((lista) => {
        const outros = lista.filter((a) => a.id !== alerta.id);
        return acao === "RESOLVIDO" ? outros : [alerta, ...outros];
      });
      setVersao((v) => v + 1);
      callback.current?.(acao, alerta);
    });
    fonte.onerror = () => setConectado(false);

    return () => fonte.close();
  }, [recarregar]);

  return { ativos, conectado, versao };
}

// ------------------------------------------------------------ toasts

export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const remover = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const mostrar = useCallback(
    (tipo, titulo, texto) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((t) => [...t.slice(-3), { id, tipo, titulo, texto }]);
      setTimeout(() => remover(id), 6000);
    },
    [remover]
  );
  return { toasts, mostrar, remover };
}

// ------------------------------------------------- consulta periodica

export function useIntervalo(fn, ms, ativo = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!ativo) return undefined;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms, ativo]);
}
