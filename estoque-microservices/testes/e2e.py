"""Teste ponta a ponta do sistema completo (rodando no docker compose).

Uso, a partir da raiz do projeto, com o ambiente no ar:
    python testes/e2e.py                 # projeto padrao do compose
    python testes/e2e.py -p meu-projeto  # se subiu com "docker compose -p"
    python testes/e2e.py --url http://localhost

So usa a biblioteca padrao do Python. Para os cenarios de falha, o script
PARA e RELIGA containers (catalogo, alertas e RabbitMQ) com docker compose.
"""

import argparse
import base64
import json
import random
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument("--url", default="http://127.0.0.1", help="endereco do API Gateway")
parser.add_argument("--rabbit", default="http://127.0.0.1:15672", help="painel do RabbitMQ")
parser.add_argument("-p", "--projeto", default=None, help="nome do projeto do docker compose")
parser.add_argument("--sem-falhas", action="store_true", help="pula os cenarios que param containers")
ARGS = parser.parse_args()

B = ARGS.url.rstrip("/")
R = ARGS.rabbit.rstrip("/") + "/api"
AUTH = "Basic " + base64.b64encode(b"guest:guest").decode()
FALHAS = []


# ------------------------------------------------------------ helpers


def req(metodo, url, corpo=None, auth=False, timeout=15):
    dados = None if corpo is None else json.dumps(corpo).encode()
    r = urllib.request.Request(url, data=dados, method=metodo)
    r.add_header("content-type", "application/json")
    if auth:
        r.add_header("authorization", AUTH)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            txt = resp.read().decode()
            if "json" not in resp.headers.get("content-type", ""):
                return resp.status, txt  # ex.: a interface (HTML)
            return resp.status, (json.loads(txt) if txt else None)
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        try:
            return e.code, json.loads(txt)
        except ValueError:
            return e.code, txt
    except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
        return 0, str(e)


def check(desc, cond, detalhe=""):
    if cond:
        print(f"  [OK]    {desc}")
    else:
        FALHAS.append(desc)
        print(f"  [FALHA] {desc} {detalhe}")


def esperar(desc, fn, timeout=30):
    fim = time.time() + timeout
    ultimo = None
    while time.time() < fim:
        try:
            ultimo = fn()
            if ultimo:
                print(f"  [OK]    {desc}")
                return ultimo
        except Exception as e:  # noqa: BLE001
            ultimo = e
        time.sleep(0.5)
    check(desc, False, f"(timeout; ultimo: {ultimo!r})")
    return None


def compose(*args, saida=False):
    cmd = ["docker", "compose"] + (["-p", ARGS.projeto] if ARGS.projeto else []) + list(args)
    r = subprocess.run(cmd, cwd=RAIZ, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)} falhou: {r.stderr.strip()}")
    return r.stdout if saida else None


def filas():
    out = compose("exec", "-T", "rabbitmq", "rabbitmqctl", "-q", "list_queues", "name", "messages", saida=True)
    resultado = {}
    for linha in out.splitlines():
        partes = linha.split()
        if len(partes) == 2 and partes[1].isdigit():
            resultado[partes[0]] = int(partes[1])
    return resultado


def outbox_pendente():
    out = compose("exec", "-T", "postgres-estoque", "psql", "-U", "estoque", "-tAc",
                  "select count(*) from outbox where publicado_em is null", saida=True)
    return int(out.strip() or 0)


def fila_espia(nome, routing_key):
    """Cria uma fila de teste ligada a exchange para 'espiar' os eventos."""
    req("DELETE", f"{R}/queues/%2F/{nome}", auth=True)
    req("PUT", f"{R}/queues/%2F/{nome}", {"durable": False, "auto_delete": False}, auth=True)
    req("POST", f"{R}/bindings/%2F/e/estoque.eventos/q/{nome}", {"routing_key": routing_key}, auth=True)


def ler_espia(nome):
    s, msgs = req("POST", f"{R}/queues/%2F/{nome}/get",
                  {"count": 500, "ackmode": "ack_requeue_false", "encoding": "auto"}, auth=True)
    return [json.loads(m["payload"]) for m in msgs] if s == 200 else []


def publicar_bruto(routing_key, payload):
    corpo = {"properties": {"delivery_mode": 2}, "routing_key": routing_key,
             "payload": payload if isinstance(payload, str) else json.dumps(payload),
             "payload_encoding": "string"}
    return req("POST", f"{R}/exchanges/%2F/estoque.eventos/publish", corpo, auth=True)


def saldo(pid):
    return req("GET", f"{B}/estoque/saldos/{pid}")


def mov(pid, tipo, qtd, obs=None):
    return req("POST", f"{B}/estoque/movimentacoes",
               {"produto_id": pid, "tipo": tipo, "quantidade": qtd, "observacao": obs})


def ativos(pid):
    return req("GET", f"{B}/alertas?status=ATIVO&produto_id={pid}")[1]


def novo_produto(minimo, inicial, nome="Produto de teste"):
    s, p = req("POST", f"{B}/produtos", {"nome": nome, "sku": f"E2E-{random.randint(1, 10**9)}",
                                         "estoque_minimo": minimo, "estoque_inicial": inicial})
    assert s == 201, (s, p)
    pid = p["id"]
    esperar(f"produto replicado no Estoque com saldo {inicial}",
            lambda: saldo(pid)[0] == 200 and saldo(pid)[1]["saldo"] == inicial)
    return pid


EVENTOS_SSE = []


def ouvir_sse():
    try:
        with urllib.request.urlopen(f"{B}/alertas/stream", timeout=600) as r:
            nome = None
            for linha in r:
                linha = linha.decode().rstrip("\n")
                if linha.startswith("event:"):
                    nome = linha[6:].strip()
                elif linha.startswith("data:") and nome == "alerta":
                    EVENTOS_SSE.append(json.loads(linha[5:]))
    except Exception:  # noqa: BLE001
        pass


# ------------------------------------------------------------ cenarios


def secao(titulo):
    print(f"\n== {titulo} ==")


def cenario_ambiente():
    secao("Ambiente no ar")
    for nome, rota in [("Catalogo", "/produtos/health"), ("Estoque", "/estoque/health"),
                       ("Alertas", "/alertas/health"), ("Interface", "/")]:
        esperar(f"{nome} respondendo via Gateway", lambda rota=rota: req("GET", B + rota)[0] == 200, 120)
    esperar("filas dos consumidores declaradas",
            lambda: {"estoque.produtos", "alertas.estoque"} <= set(filas()), 60)
    fila_espia("e2e.produtos", "produto.*")
    fila_espia("e2e.estoque", "estoque.atualizado")
    threading.Thread(target=ouvir_sse, daemon=True).start()


def cenario_catalogo():
    secao("Catalogo: validacoes")
    sku = f"E2E-{random.randint(1, 10**9)}"
    s, p = req("POST", f"{B}/produtos", {"nome": "  Teclado ", "sku": sku, "categoria": "Perifericos",
                                         "preco": 250, "estoque_minimo": 10,
                                         "atributos": {"switch": "Blue"}, "estoque_inicial": 50})
    check("cadastro -> 201 com trim e atributos", s == 201 and p["nome"] == "Teclado" and p["atributos"] == {"switch": "Blue"}, (s, p))
    check("resposta nao expoe o outbox interno", "eventos_pendentes" not in p)
    check("SKU duplicado -> 409", req("POST", f"{B}/produtos", {"nome": "X", "sku": sku})[0] == 409)
    check("estoque_inicial negativo -> 400", req("POST", f"{B}/produtos", {"nome": "X", "sku": "N1", "estoque_inicial": -1})[0] == 400)
    check("atributos nao-objeto -> 400", req("POST", f"{B}/produtos", {"nome": "X", "sku": "N2", "atributos": [1]})[0] == 400)
    check("sem nome -> 400", req("POST", f"{B}/produtos", {"sku": "N3"})[0] == 400)
    check("PUT sem campos editaveis -> 400", req("PUT", f"{B}/produtos/{p['id']}", {"saldo": 1})[0] == 400)
    check("id inexistente -> 404", req("GET", f"{B}/produtos/abc")[0] == 404)
    return p["id"]


def cenario_estoque(pid):
    secao("Estoque: replicacao, movimentacoes e estorno")
    esperar("Estoque recebeu produto.criado com saldo 50",
            lambda: saldo(pid)[0] == 200 and saldo(pid)[1]["saldo"] == 50)
    movs = req("GET", f"{B}/estoque/movimentacoes?produto_id={pid}")[1]
    check("estoque inicial virou ENTRADA de origem ESTOQUE_INICIAL",
          len(movs) == 1 and movs[0]["origem"] == "ESTOQUE_INICIAL", movs)

    s, venda = mov(pid, "SAIDA", 10, "Venda")
    check("SAIDA 10 -> saldo 40", s == 201 and venda["saldo_apos"] == 40, (s, venda))
    s, r = mov(pid, "SAIDA", 100)
    check("SAIDA acima do saldo -> 409 com saldo atual", s == 409 and r.get("saldo_atual") == 40, (s, r))
    check("ENTRADA 5 -> saldo 45", mov(pid, "ENTRADA", 5)[1]["saldo_apos"] == 45)
    check("quantidade 0 -> 400", mov(pid, "SAIDA", 0)[0] == 400)
    check("produto desconhecido -> 404", mov("nao-existe", "ENTRADA", 1)[0] == 404)

    s, est = req("POST", f"{B}/estoque/movimentacoes/{venda['id']}/estorno", {})
    check("estorno da venda -> ENTRADA 10, saldo 55", s == 201 and est["tipo"] == "ENTRADA" and est["saldo_apos"] == 55, (s, est))
    check("estornar de novo -> 409", req("POST", f"{B}/estoque/movimentacoes/{venda['id']}/estorno", {})[0] == 409)
    check("estornar um estorno -> 400", req("POST", f"{B}/estoque/movimentacoes/{est['id']}/estorno", {})[0] == 400)

    secao("Estoque: 20 vendas simultaneas de 5 com saldo 55")
    with ThreadPoolExecutor(20) as ex:
        res = list(ex.map(lambda _: mov(pid, "SAIDA", 5)[0], range(20)))
    check("exatamente 11 aceitas e 9 recusadas", res.count(201) == 11 and res.count(409) == 9, res)
    check("saldo final 0, nunca negativo", saldo(pid)[1]["saldo"] == 0)

    secao("Catalogo -> Estoque: atualizacao")
    req("PUT", f"{B}/produtos/{pid}", {"nome": "Teclado RGB", "estoque_minimo": 20})
    esperar("Estoque recebeu nome e minimo novos",
            lambda: saldo(pid)[1]["nome"] == "Teclado RGB" and saldo(pid)[1]["estoque_minimo"] == 20)


def cenario_idempotencia(pid):
    secao("Mensageria: idempotencia, versao e DLQ")
    time.sleep(1)
    criado = next(e for e in ler_espia("e2e.produtos")
                  if e["tipo"] == "produto.criado" and e["dados"]["produto_id"] == pid)
    dlq_antes = filas().get("estoque.produtos.dlq", 0)
    publicar_bruto("produto.criado", criado)  # mesmo event_id
    publicar_bruto("produto.atualizado", dict(criado, event_id=f"antigo-{pid}", tipo="produto.atualizado",
                                              versao=1, dados=dict(criado["dados"], nome="NOME ANTIGO")))
    publicar_bruto("produto.criado", "isto nao e json")
    time.sleep(3)
    iniciais = [m for m in req("GET", f"{B}/estoque/movimentacoes?produto_id={pid}")[1] if m["origem"] == "ESTOQUE_INICIAL"]
    check("evento repetido nao gerou segunda ENTRADA inicial", len(iniciais) == 1)
    check("evento de versao antiga ignorado", saldo(pid)[1]["nome"] == "Teclado RGB")
    check("mensagem invalida foi para estoque.produtos.dlq", filas().get("estoque.produtos.dlq", 0) == dlq_antes + 1)

    eventos = [e for e in ler_espia("e2e.estoque") if e["dados"]["produto_id"] == pid]
    motivos = [e["dados"]["motivo"] for e in eventos]
    check("estoque.atualizado publicado a cada movimentacao (15)", motivos.count("MOVIMENTACAO") == 15, len(motivos))
    check("estoque.atualizado publicado ao mudar o minimo", motivos.count("MINIMO_ALTERADO") == 1)
    versoes = [e["versao"] for e in eventos]
    check("versoes unicas por produto", len(set(versoes)) == len(versoes))


def cenario_alertas():
    secao("Alertas: ciclo de vida e tempo real (SSE)")
    pid = novo_produto(minimo=10, inicial=12, nome="Mouse")
    time.sleep(1.5)
    check("saldo 12 / minimo 10: nenhum alerta", ativos(pid) == [])
    mov(pid, "SAIDA", 4)
    esperar("SAIDA 4 (saldo 8): alerta aberto", lambda: len(ativos(pid)) == 1)
    mov(pid, "SAIDA", 2)
    esperar("SAIDA 2 (saldo 6): o MESMO alerta atualizado", lambda: (lambda a: len(a) == 1 and a[0]["saldo"] == 6)(ativos(pid)))
    mov(pid, "ENTRADA", 5)
    esperar("ENTRADA 5 (saldo 11): alerta resolvido", lambda: ativos(pid) == [])
    req("PUT", f"{B}/produtos/{pid}", {"estoque_minimo": 20})
    esperar("minimo alterado para 20: novo alerta sem movimentacao", lambda: len(ativos(pid)) == 1)
    time.sleep(1)
    acoes = [e["acao"] for e in EVENTOS_SSE if e["alerta"]["produto_id"] == pid]
    check("tela (SSE) recebeu ABERTO, ATUALIZADO, RESOLVIDO, ABERTO",
          acoes == ["ABERTO", "ATUALIZADO", "RESOLVIDO", "ABERTO"], acoes)
    check("status invalido -> 400", req("GET", f"{B}/alertas?status=X")[0] == 400)


def cenario_falhas():
    secao("Falha 1: Catalogo fora do ar -> vendas continuam")
    pid = novo_produto(minimo=10, inicial=15, nome="Monitor")
    compose("stop", "catalogo-service")
    try:
        check("cadastro falha (502) com o Catalogo parado", req("GET", f"{B}/produtos")[0] in (502, 503))
        s, r = mov(pid, "SAIDA", 3, "Venda com catalogo fora")
        check("SAIDA no Estoque funciona com o Catalogo parado", s == 201, (s, r))
    finally:
        compose("start", "catalogo-service")

    secao("Falha 2: Alertas fora do ar -> eventos acumulam na fila")
    compose("stop", "alertas-service")
    try:
        for _ in range(3):
            mov(pid, "SAIDA", 2)  # 12 -> 10 -> 8 -> 6
        esperar("3 eventos guardados na fila alertas.estoque",
                lambda: filas().get("alertas.estoque", 0) == 3, 20)
    finally:
        compose("start", "alertas-service")
    esperar("ao voltar, Alertas processa a fila e abre o alerta com saldo 6",
            lambda: (lambda a: len(a) == 1 and a[0]["saldo"] == 6)(ativos(pid)), 90)
    check("fila esvaziada", filas().get("alertas.estoque", 0) == 0)

    secao("Falha 3: RabbitMQ fora do ar -> outbox guarda os eventos")
    compose("stop", "rabbitmq")
    try:
        s, r = mov(pid, "ENTRADA", 10, "Reposicao com broker fora")
        check("ENTRADA aceita com o RabbitMQ parado", s == 201, (s, r))
        esperar("evento aguardando no outbox do Estoque", lambda: outbox_pendente() >= 1, 15)
    finally:
        compose("start", "rabbitmq")
    esperar("outbox esvaziado depois que o broker voltou", lambda: outbox_pendente() == 0, 120)
    esperar("alerta resolvido (saldo 16) apos o evento chegar", lambda: ativos(pid) == [], 90)

    secao("Remocao no Catalogo bloqueia movimentacoes")
    esperar("Catalogo de volta", lambda: req("GET", f"{B}/produtos/health")[0] == 200, 60)
    check("DELETE -> 204", req("DELETE", f"{B}/produtos/{pid}")[0] == 204)
    esperar("item inativo no Estoque", lambda: saldo(pid)[1]["ativo"] is False, 60)
    check("movimentacao em produto removido -> 409", mov(pid, "ENTRADA", 1)[0] == 409)


def limpar():
    for nome in ("e2e.produtos", "e2e.estoque"):
        req("DELETE", f"{R}/queues/%2F/{nome}", auth=True)


def main():
    inicio = time.time()
    try:
        cenario_ambiente()
        pid = cenario_catalogo()
        cenario_estoque(pid)
        cenario_idempotencia(pid)
        cenario_alertas()
        if not ARGS.sem_falhas:
            cenario_falhas()
    finally:
        limpar()

    print(f"\nTempo: {time.time() - inicio:.0f}s")
    if FALHAS:
        print(f"{len(FALHAS)} FALHA(S):")
        for f in FALHAS:
            print(f"  - {f}")
        sys.exit(1)
    print("Todos os cenarios passaram.")


if __name__ == "__main__":
    main()
