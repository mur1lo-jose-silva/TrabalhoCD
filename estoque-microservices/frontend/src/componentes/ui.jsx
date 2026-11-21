export function Badge({ tom = "neutro", children, titulo }) {
  return (
    <span className={`badge badge-${tom}`} title={titulo}>
      {children}
    </span>
  );
}

export function Aviso({ tom = "erro", children, aoFechar }) {
  if (!children) return null;
  return (
    <div className={`aviso aviso-${tom}`} role={tom === "erro" ? "alert" : "status"}>
      <span>{children}</span>
      {aoFechar && (
        <button className="btn-icone" onClick={aoFechar} aria-label="Fechar aviso">
          ×
        </button>
      )}
    </div>
  );
}

export function Toasts({ toasts, aoFechar }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tipo}`}>
          <div>
            <strong>{t.titulo}</strong>
            {t.texto && <p>{t.texto}</p>}
          </div>
          <button className="btn-icone" onClick={() => aoFechar(t.id)} aria-label="Fechar">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function Vazio({ children }) {
  return <div className="vazio">{children}</div>;
}

export function Cabecalho({ titulo, descricao, children }) {
  return (
    <div className="cabecalho-pagina">
      <div>
        <h1>{titulo}</h1>
        {descricao && <p className="descricao">{descricao}</p>}
      </div>
      {children && <div className="acoes">{children}</div>}
    </div>
  );
}
