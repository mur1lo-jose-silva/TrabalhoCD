# Sistema de Gerenciamento de Estoque — Arquitetura de Microsserviços

Trabalho prático de **Sistemas Distribuídos e Arquitetura de Microsserviços**.

Um sistema de estoque dividido em **três microsserviços heterogêneos** (Node.js e
Python), cada um com o **próprio banco de dados**, que se comunicam por
**eventos no RabbitMQ**, com **API Gateway** (Traefik), **interface web** (React)
e **observabilidade** (Prometheus + Grafana).

---

## 1. Arquitetura

```
                       ┌──────────────────── Traefik (porta 80) ─────────────────────┐
                       │   /            /produtos         /estoque         /alertas   │
                       └───┬──────────────┬─────────────────┬────────────────┬──────┘
                           ▼              ▼                 ▼                ▼
                      Interface       Catálogo           Estoque          Alertas
                      React+nginx     Node + MongoDB     Python + Postgres Node + MongoDB
                                         │                 │   ▲              ▲
                          produto.criado │                 │   │ produto.*    │ estoque.atualizado
                       produto.atualizado│                 │   │              │
                         produto.removido│   estoque.atualizado               │
                                         ▼                 ▼   │              │
                       ┌──────────── exchange "estoque.eventos" (topic) ─────────────┐
                       │  fila estoque.produtos ← produto.*                          │
                       │  fila alertas.estoque  ← estoque.atualizado                 │
                       │  + exchange "estoque.dlx" com uma DLQ por fila              │
                       └─────────────────────────────────────────────────────────────┘

       Prometheus ── coleta /metrics ──▶ serviços, RabbitMQ e Traefik
       Grafana    ── dashboard pronto ──▶ Prometheus
```

| Serviço | Linguagem | Banco | É dono de | Publica | Consome |
|---|---|---|---|---|---|
| **Catálogo** | Node.js / Express | MongoDB | O que a empresa vende: nome, SKU, preço, estoque mínimo, **atributos livres por categoria** | `produto.*` | — |
| **Estoque** | Python / FastAPI | PostgreSQL | **Saldo** e **histórico de movimentações** (+ cópia local dos produtos) | `estoque.atualizado` | `produto.*` |
| **Alertas** | Node.js / Express | MongoDB (próprio) | Alertas de estoque abaixo do mínimo | — | `estoque.atualizado` |
| **Interface** | React (Vite) + nginx | — | Telas | — | API + SSE |

### Como um dia de uso passa pelo sistema

1. O gerente **cadastra** um produto com estoque inicial 50 → o **Catálogo** grava e publica `produto.criado`.
2. O **Estoque** consome o evento, cria a cópia local do produto e registra uma **ENTRADA inicial** de 50.
3. O vendedor registra uma **SAÍDA** → o Estoque valida o saldo **na hora** (na mesma transação) e publica `estoque.atualizado`.
4. Se o saldo ficou abaixo do mínimo, o **Alertas** abre um alerta e o **empurra para a tela** (Server-Sent Events).

---

## 2. Decisões de arquitetura

### Por que Catálogo e Estoque são serviços separados
São perguntas diferentes do negócio: o Catálogo responde **o que** vendemos; o
Estoque responde **quanto temos e por quê**. Saldo e movimentações ficam
**juntos** no Estoque porque o saldo é a soma das movimentações: assim, validar
"posso tirar 10 unidades?" é uma única transação, sem saga e sem saldo negativo.

### Por que cada banco
| Serviço | Banco | Motivo |
|---|---|---|
| Catálogo | MongoDB | Cada categoria tem atributos diferentes (switch de teclado, resolução de monitor…). Documentos aceitam isso sem mudar esquema. |
| Estoque | PostgreSQL | Dados transacionais: `UPDATE` condicional, `CHECK (saldo >= 0)`, `UNIQUE`, transações ACID. |
| Alertas | MongoDB | Lista simples de alertas, isolada dos outros serviços. |

### Síncrono × assíncrono
> **Chamada síncrona** onde o usuário precisa de resposta imediata (validar
> saldo). **Evento** onde um serviço não deve depender do outro (replicar o
> catálogo e notificar alertas).

| Benefício da mensageria | Onde aparece |
|---|---|
| **Desacoplamento temporal** | Alertas fora do ar? Os eventos esperam na fila e são processados quando ele volta. |
| **Pub/sub** | O Estoque publica `estoque.atualizado` sem saber que o Alertas existe. Um novo serviço (ex.: Compras) só cria a própria fila. |
| **Autonomia de dados** | O Estoque tem a própria cópia dos produtos: vendas continuam com o Catálogo fora do ar. |

### Garantias de entrega
| Problema | Solução | Onde |
|---|---|---|
| Broker fora do ar na hora de publicar | **Outbox**: o evento é gravado no banco junto com a mudança e publicado depois, com *publisher confirms* | Catálogo (no próprio documento) e Estoque (tabela `outbox`) |
| Mensagem entregue duas vezes | **Idempotência**: `event_id` já processado é ignorado | Estoque (tabela `eventos_processados`), Alertas (versão por produto + ações por estado) |
| Eventos fora de ordem | **Versão** do recurso no evento; versões antigas são ignoradas | Estoque e Alertas |
| Mensagem com erro travando a fila | **Dead-letter queue** (`<fila>.dlq`) | Estoque e Alertas |
| Duas vendas ao mesmo tempo | `UPDATE ... WHERE saldo >= quantidade` + `CHECK` | Estoque |

O contrato completo das mensagens está em **[docs/eventos.md](docs/eventos.md)**.

### Requisitos do trabalho

| Requisito | Implementação |
|---|---|
| Heterogeneidade (2+ linguagens) | **Node.js** (Catálogo, Alertas) + **Python** (Estoque) |
| Database per Service | **MongoDB** (Catálogo), **PostgreSQL** (Estoque), **MongoDB** separado (Alertas) |
| Conteinerização e orquestração | **Docker** + **docker-compose.yml** com healthchecks |
| API Gateway / Roteamento | **Traefik**: porta única 80, roteamento por caminho |
| Observabilidade | **Prometheus** + **Grafana** com dashboard provisionado |
| Mensageria assíncrona | **RabbitMQ** com exchange topic, outbox, idempotência e DLQ |
| Comunicação padronizada | **JSON** sobre HTTP (REST), nos eventos e no SSE |

---

## 3. Como executar

**Pré-requisitos:** Docker com Docker Compose, 4 GB de memória livres para o
Docker e as portas `80`, `8080`, `9090`, `3001` e `15672` livres.

```bash
docker compose up --build
```

Na primeira vez leva alguns minutos (download das imagens e build). Para rodar
em segundo plano e esperar tudo ficar saudável:

```bash
docker compose up --build -d --wait
```

Para derrubar:

```bash
docker compose down        # para os contêineres (os dados ficam)
docker compose down -v     # para e apaga os bancos e filas
```

> **Windows:** se `http://localhost` demorar ou não abrir, use `http://127.0.0.1`.

### Endereços

| O quê | URL | Acesso |
|---|---|---|
| **Interface** | http://localhost | — |
| Grafana (dashboard "Estoque · Microsserviços") | http://localhost:3001 | aberto para leitura; admin/admin para editar |
| RabbitMQ (filas e exchanges) | http://localhost:15672 | guest / guest |
| Prometheus | http://localhost:9090 | — |
| Traefik (rotas) | http://localhost:8080 | — |

---

## 4. Interface

| Tela | O que faz |
|---|---|
| **Produtos** | Catálogo com o saldo vindo do Estoque. Mostra "sincronizando…" enquanto o Estoque ainda não recebeu o evento. Se o Catálogo cair, a lista passa a vir da cópia local do Estoque. |
| **Novo / editar produto** | Campos fixos, **atributos dinâmicos** e estoque inicial (só na criação). O saldo não é editável. |
| **Movimentações** | Registra ENTRADA/SAÍDA com resposta imediata ("saldo insuficiente"), histórico filtrável e **estorno**. |
| **Alertas** | Alertas ativos e fechados, **ao vivo** via SSE. Um alerta é **resolvido** quando o estoque é reposto e **encerrado** quando o produto é removido do catálogo. |

---

## 5. API (tudo pelo Gateway, porta 80)

Erros sempre no formato `{"erro": "mensagem"}`.

### Catálogo — `/produtos`
| Método | Rota | Descrição |
|---|---|---|
| GET | `/produtos` | Lista (filtros `categoria`, `incluir_inativos=true`) |
| POST | `/produtos` | Cadastra. Aceita `estoque_inicial` (vai no evento, não é guardado aqui) |
| GET | `/produtos/{id}` | Detalhe |
| PUT | `/produtos/{id}` | Edição parcial (nome, sku, categoria, preco, estoque_minimo, atributos) |
| DELETE | `/produtos/{id}` | Remoção lógica. Não é baixa de estoque: saldo e histórico ficam no Estoque, e um alerta ativo do produto é encerrado |

### Estoque — `/estoque`
| Método | Rota | Descrição |
|---|---|---|
| GET | `/estoque/saldos` | Saldo de todos os produtos (`incluir_inativos=true`) |
| GET | `/estoque/saldos/{produto_id}` | Saldo de um produto |
| POST | `/estoque/movimentacoes` | Registra ENTRADA/SAÍDA. `409` se o saldo for insuficiente |
| GET | `/estoque/movimentacoes` | Histórico (filtros `produto_id`, `tipo`, `limite`) |
| GET | `/estoque/movimentacoes/{id}` | Detalhe |
| POST | `/estoque/movimentacoes/{id}/estorno` | Estorna (cria a movimentação oposta) |

Não existe `PUT` nem `DELETE` de movimentação: o histórico é imutável.

### Alertas — `/alertas`
| Método | Rota | Descrição |
|---|---|---|
| GET | `/alertas` | Lista (filtros `status=ATIVO\|RESOLVIDO\|ENCERRADO`, aceita lista separada por vírgula; `produto_id`; `limite`) |
| GET | `/alertas/{id}` | Detalhe |
| GET | `/alertas/stream` | Fluxo em tempo real (Server-Sent Events) |

### Exemplo pela linha de comando

```bash
# cadastrar (no PowerShell use curl.exe)
curl -X POST http://localhost/produtos -H "Content-Type: application/json" \
  -d '{"nome":"Teclado Mecânico","sku":"TEC-001","preco":250,"estoque_minimo":10,"estoque_inicial":12,"atributos":{"switch":"Blue"}}'

# vender 4 (troque <ID> pelo "id" retornado)
curl -X POST http://localhost/estoque/movimentacoes -H "Content-Type: application/json" \
  -d '{"produto_id":"<ID>","tipo":"SAIDA","quantidade":4,"observacao":"Venda balcão"}'

curl http://localhost/estoque/saldos/<ID>
curl http://localhost/alertas?status=ATIVO
```
---

## 6. Testes

| Nível | O que cobre | Como rodar |
|---|---|---|
| **Unidade — Alertas** | Regra de abrir/atualizar/resolver e validação de eventos | `cd alertas-service && npm install && npm test` |
| **Integração — Estoque** | Regras com Postgres real: saldo, concorrência, estorno, idempotência, versão | ver abaixo |
| **Ponta a ponta** | O sistema inteiro, incluindo os 3 cenários de falha | `python testes/e2e.py` (com o ambiente no ar) |

Testes do Estoque (usam o Postgres do compose, num banco separado `estoque_teste`):

```bash
docker compose up -d --wait postgres-estoque
docker compose run --rm --no-deps -v ./estoque-service:/src -w /src estoque-service \
  sh -c "pip install -q -r requirements-dev.txt && pytest -q"
```

O teste ponta a ponta para e religa contêineres; use `--sem-falhas` para pular
essa parte, ou `-p <projeto>` se subiu o compose com outro nome de projeto.

---

## 7. Estrutura do projeto

```
estoque-microservices/
├── docker-compose.yml           # orquestração (healthchecks, dependências)
├── docs/eventos.md              # contrato das mensagens entre serviços
├── gateway/                     # Traefik: traefik.yml (estático), dynamic.yml (rotas)
├── catalogo-service/            # Node + MongoDB
│   └── src/  model.js · routes.js · outbox.js · eventos.js · metricas.js · server.js
├── estoque-service/             # Python + Postgres
│   ├── app/  models.py · servico.py (regras) · consumer.py · outbox.py · main.py
│   └── tests/                   # pytest com Postgres real
├── alertas-service/             # Node + MongoDB
│   ├── src/  regras.js · processador.js · consumer.js · sse.js · routes.js
│   └── test/                    # node --test
├── frontend/                    # React + Vite, servido por nginx
│   └── src/  App.jsx · api.js · hooks.js · paginas/
├── observability/
│   ├── prometheus/prometheus.yml
│   └── grafana/provisioning/    # datasource + dashboard versionado
└── testes/e2e.py                # teste ponta a ponta
```

---

## 8. Possíveis evoluções

- **Serviço de Compras**: consumir `estoque.atualizado` e gerar pedidos de
  reposição automaticamente — sem alterar nenhum serviço existente.
- **Autenticação e perfis** (gerente, vendedor, almoxarife) no Gateway.
- **Réplicas** dos serviços atrás do Traefik (os consumidores já são
  idempotentes e o saldo é protegido no banco).
- MongoDB em **replica set**, permitindo transações entre documentos no Catálogo.
