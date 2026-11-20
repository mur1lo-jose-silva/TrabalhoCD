# Sistema de Gerenciamento de Estoque — Arquitetura de Microsserviços

Trabalho prático de **Sistemas Distribuídos e Arquitetura de Microsserviços**.
Aplicação de gerenciamento de estoque dividida em dois microsserviços
heterogêneos, cada um com seu próprio banco de dados, comunicando-se de forma
assíncrona via message broker, com roteamento centralizado por API Gateway e
observabilidade com métricas.

---

## 1. Arquitetura

```
                        ┌───────────────────────────┐
     Cliente  ───────▶  │   Traefik (API Gateway)    │   porta 80
                        └─────────────┬─────────────┘
                           /produtos  │  /movimentacoes
                   ┌───────────────────┴────────────────────┐
                   ▼                                         ▼
        ┌──────────────────────┐                ┌──────────────────────────┐
        │  Serviço Produtos     │                │  Serviço Movimentações    │
        │  Python / FastAPI     │                │  Node.js / Express        │
        └──────────┬───────────┘                └────────────┬─────────────┘
                   │                                          │
                   ▼                                          ▼
            ┌────────────┐                            ┌────────────┐
            │  Postgres  │                            │  MongoDB   │
            └────────────┘                            └────────────┘
                   ▲                                          │
                   │          evento de movimentação          │
                   └──────────────  RabbitMQ  ◀───────────────┘
                              (fila: movimentacoes.estoque)

        Prometheus  ──coleta /metrics──▶  (produtos e movimentacoes)
        Grafana     ──visualiza──▶  Prometheus
```

### Como os princípios do trabalho são atendidos

| Requisito | Implementação |
|---|---|
| Heterogeneidade (2 linguagens) | **Python (FastAPI)** + **Node.js (Express)** |
| Database per Service | **Postgres** (produtos) + **MongoDB** (movimentações), isolados |
| Conteinerização e orquestração | **Docker** + **docker-compose.yml** |
| API Gateway / Roteamento | **Traefik** (porta única 80, roteamento por path) |
| Observabilidade | **Prometheus** (métricas) + **Grafana** (dashboards) |
| Mensageria assíncrona (bônus) | **RabbitMQ** (evento a cada movimentação) |
| Comunicação padronizada | **JSON** sobre HTTP (REST) e nas mensagens |

### Fluxo de eventos (o coração do sistema)

1. Uma movimentação (ENTRADA ou SAIDA) é registrada no **Serviço de Movimentações**.
2. O serviço grava no MongoDB e **publica um evento** no RabbitMQ.
3. O **Serviço de Produtos** consome o evento e **atualiza o saldo** do produto no Postgres.

Isso demonstra o desacoplamento: nenhum serviço acessa o banco do outro — eles se
sincronizam apenas por mensagens.

---

## 2. Pré-requisitos

- **Docker** e **Docker Compose** instalados ([instruções oficiais](https://docs.docker.com/get-docker/)).
- Portas livres na máquina: `80`, `8080`, `9090`, `3001`, `15672`.

---

## 3. Como executar (máquina limpa)

```bash
# 1. Clonar o repositório
git clone <URL_DO_REPOSITORIO>
cd estoque-microservices

# 2. Subir todo o ambiente distribuído (um único comando)
docker compose up --build
```

Aguarde alguns segundos até todos os contêineres ficarem prontos. Para rodar em
segundo plano, use `docker compose up --build -d`.

Para derrubar tudo:

```bash
docker compose down          # para os contêineres
docker compose down -v       # para e apaga também os volumes (bancos zerados)
```

---

## 4. Painéis e portas

| Serviço | URL | Credenciais |
|---|---|---|
| **Front end (painel web)** | **http://localhost** | — |
| API via Gateway | http://localhost/produtos · http://localhost/movimentacoes | — |
| Dashboard do Traefik | http://localhost:8080 | — |
| Prometheus | http://localhost:9090 | — |
| Grafana | http://localhost:3001 | admin / admin |
| RabbitMQ (admin) | http://localhost:15672 | guest / guest |

---

## 5. Endpoints da API (todos via `http://localhost`)

### Serviço de Produtos — `/produtos`

| Método | Rota | Descrição |
|---|---|---|
| GET | `/produtos` | Lista produtos |
| POST | `/produtos` | Cria produto |
| GET | `/produtos/{id}` | Busca por id |
| PUT | `/produtos/{id}` | Atualiza produto |
| DELETE | `/produtos/{id}` | Remove produto |

### Serviço de Movimentações — `/movimentacoes`

| Método | Rota | Descrição |
|---|---|---|
| GET | `/movimentacoes` | Lista movimentações |
| POST | `/movimentacoes` | Cria movimentação (publica evento) |
| GET | `/movimentacoes/{id}` | Busca por id |
| PUT | `/movimentacoes/{id}` | Atualiza movimentação |
| DELETE | `/movimentacoes/{id}` | Remove movimentação |

---

## 6. Roteiro de teste (ideal para a apresentação)

```bash
# 1. Criar um produto com saldo inicial de 50
curl -X POST http://localhost/produtos \
  -H "Content-Type: application/json" \
  -d '{"nome":"Teclado Mecânico","sku":"TEC-001","categoria":"Periféricos","preco":250.0,"quantidade_estoque":50,"estoque_minimo":10}'

# 2. Conferir o produto criado (anote o "id" retornado, ex.: 1)
curl http://localhost/produtos

# 3. Registrar uma SAÍDA de 10 unidades do produto de id 1
curl -X POST http://localhost/movimentacoes \
  -H "Content-Type: application/json" \
  -d '{"produto_id":1,"tipo":"SAIDA","quantidade":10,"observacao":"Venda balcão"}'

# 4. Conferir o saldo do produto: deve ter caído de 50 para 40 (atualizado via RabbitMQ)
curl http://localhost/produtos/1

# 5. Registrar uma ENTRADA de 5 unidades
curl -X POST http://localhost/movimentacoes \
  -H "Content-Type: application/json" \
  -d '{"produto_id":1,"tipo":"ENTRADA","quantidade":5,"observacao":"Reposição"}'

# 6. Conferir novamente: saldo deve ir de 40 para 45
curl http://localhost/produtos/1
```

> **Dica de apresentação:** deixe `docker compose logs -f produtos-service`
> aberto em um terminal. A cada movimentação você verá a mensagem sendo
> consumida e o saldo sendo atualizado em tempo real — prova visual da
> mensageria funcionando.

---

## 7. Observabilidade

- **Prometheus** (http://localhost:9090) coleta as métricas expostas em
  `/metrics` por cada serviço. Em *Status → Targets* os dois serviços devem
  aparecer como `UP`.
- **Grafana** (http://localhost:3001) já vem com o Prometheus configurado como
  fonte de dados. Crie um painel e experimente a query `http_requests_total`
  para ver o número de requisições por serviço.

---

## 8. Estrutura do projeto

```
estoque-microservices/
├── docker-compose.yml          # orquestração de todo o ambiente
├── README.md
├── frontend/                   # painel web (HTML/CSS/JS + Nginx)
│   ├── Dockerfile
│   └── index.html              # UI de produtos e movimentações
├── gateway/                    # configuração do Traefik (API Gateway)
│   ├── traefik.yml             # config estática (entrypoints, dashboard)
│   └── dynamic.yml             # rotas: / (UI), /produtos e /movimentacoes
├── produtos-service/           # Python + FastAPI + Postgres
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py             # rotas CRUD + métricas
│       ├── database.py         # conexão Postgres
│       ├── models.py           # modelo Produto
│       ├── schemas.py          # validação (Pydantic)
│       └── consumer.py         # consome eventos do RabbitMQ
├── movimentacoes-service/      # Node.js + Express + MongoDB
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── server.js           # app + métricas
│       ├── db.js               # conexão MongoDB
│       ├── model.js            # schema Movimentacao
│       ├── routes.js           # rotas CRUD
│       └── publisher.js        # publica eventos no RabbitMQ
└── observability/
    ├── prometheus/prometheus.yml
    └── grafana/provisioning/datasources/datasource.yml
```

---

## 9. Possíveis melhorias (extras)

- **Serviço de Alertas**: um terceiro microsserviço que apenas consome os eventos
  do RabbitMQ e gera um alerta quando o saldo cruza o `estoque_minimo`.
- Publicar eventos compensatórios também na edição/remoção de movimentações.
- Dashboards do Grafana versionados via *provisioning*.
