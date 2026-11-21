# Contrato de eventos

Este documento é o **acordo entre os serviços** sobre as mensagens trocadas pelo
RabbitMQ. Como os serviços são escritos em linguagens diferentes (Node.js e
Python), o contrato é definido apenas em **JSON**: nenhum serviço conhece o código
do outro, só o formato das mensagens.

---

## 1. Topologia no RabbitMQ

| Elemento | Nome | Tipo | Observação |
|---|---|---|---|
| Exchange principal | `estoque.eventos` | `topic`, durável | Todos os produtores publicam aqui |
| Exchange de descarte | `estoque.dlx` | `topic`, durável | Recebe mensagens que falharam no processamento |
| Fila do Estoque | `estoque.produtos` | durável | Ligada a `produto.*` |
| Fila do Alertas | `alertas.estoque` | durável | Ligada a `estoque.atualizado` |
| Filas de descarte | `<fila>.dlq` | durável | Uma por fila consumidora |

**Regras:**
- O **produtor** declara apenas a exchange. Ele não sabe quem consome.
- Cada **consumidor** declara a própria fila e a liga (`bind`) à exchange com as
  routing keys que lhe interessam. Um novo consumidor não exige nenhuma mudança
  no produtor.
- A routing key de cada mensagem é igual ao campo `tipo` do envelope.

---

## 2. Envelope (comum a todos os eventos)

```json
{
  "event_id": "8b0c5c8e-6f0a-4a4b-9a43-2f4b8f7f1c2e",
  "tipo": "produto.criado",
  "versao": 1,
  "ocorrido_em": "2026-11-20T14:00:00.000Z",
  "origem": "catalogo-service",
  "dados": { }
}
```

| Campo | Tipo | Descrição |
|---|---|---|
| `event_id` | string (UUID) | Identificador único. Usado pelos consumidores para **idempotência** |
| `tipo` | string | Nome do evento e routing key |
| `versao` | inteiro | Versão do recurso **após** a mudança. Usado para descartar eventos antigos ou fora de ordem |
| `ocorrido_em` | string (ISO 8601, UTC) | Momento em que o fato aconteceu |
| `origem` | string | Serviço que publicou |
| `dados` | objeto | Conteúdo específico de cada tipo (abaixo) |

Mensagens são publicadas com `content_type: application/json` e
`delivery_mode: 2` (persistentes).

---

## 3. Eventos

### 3.1 `produto.criado`
- **Publicado por:** Catálogo, quando um produto é cadastrado.
- **Consumido por:** Estoque (cria a cópia local do produto e, se
  `estoque_inicial > 0`, registra uma ENTRADA inicial).

```json
{
  "produto_id": "6740a1b2c3d4e5f601234567",
  "nome": "Teclado Mecânico",
  "sku": "TEC-001",
  "categoria": "Periféricos",
  "estoque_minimo": 10,
  "estoque_inicial": 50
}
```

`estoque_inicial` **não é guardado no Catálogo**: o saldo pertence ao Estoque. O
valor só viaja no evento para virar uma movimentação de ENTRADA lá.

### 3.2 `produto.atualizado`
- **Publicado por:** Catálogo, quando um produto é editado.
- **Consumido por:** Estoque (atualiza a cópia local).

Leva o **estado completo** dos campos replicados (não só os alterados), para que o
consumidor possa simplesmente substituir a sua cópia se a `versao` for mais nova.

```json
{
  "produto_id": "6740a1b2c3d4e5f601234567",
  "nome": "Teclado Mecânico RGB",
  "sku": "TEC-001",
  "categoria": "Periféricos",
  "estoque_minimo": 15,
  "campos_alterados": ["nome", "estoque_minimo"]
}
```

### 3.3 `produto.removido`
- **Publicado por:** Catálogo, quando um produto é removido (remoção lógica).
- **Consumido por:** Estoque (marca o item como inativo: o histórico é mantido e
  novas movimentações são bloqueadas).

```json
{ "produto_id": "6740a1b2c3d4e5f601234567" }
```

### 3.4 `estoque.atualizado`
- **Publicado por:** Estoque, a cada movimentação confirmada e quando o estoque
  mínimo de um produto muda.
- **Consumido por:** Alertas (abre um alerta quando o saldo cai abaixo do mínimo
  e o resolve quando volta ao mínimo ou acima).

```json
{
  "produto_id": "6740a1b2c3d4e5f601234567",
  "nome": "Teclado Mecânico",
  "sku": "TEC-001",
  "saldo_anterior": 12,
  "saldo_atual": 8,
  "estoque_minimo": 10,
  "movimentacao_id": 42,
  "motivo": "MOVIMENTACAO"
}
```

`motivo` é `MOVIMENTACAO` ou `MINIMO_ALTERADO`. No segundo caso,
`movimentacao_id` é `null` e `saldo_anterior` é igual a `saldo_atual`.

---

## 4. Garantias e responsabilidades

| Garantia | Como é obtida |
|---|---|
| **Nenhum evento se perde se o broker cair** | Produtores usam **outbox**: o evento é gravado no mesmo banco e na mesma operação atômica que a mudança de dados, e um laço em segundo plano o publica com *publisher confirms* |
| **Entrega pelo menos uma vez** | Filas e mensagens duráveis, `ack` manual só depois de gravar no banco |
| **Duplicatas não causam efeito duplo** | Estoque: guarda os `event_id` já processados, na mesma transação da alteração. Alertas (MongoDB, sem transação entre documentos): guarda a última `versao` aplicada por produto e só executa ações que dependem do estado atual (abrir só se não há alerta ativo, resolver só se há), então reaplicar um evento não tem efeito |
| **Eventos antigos não sobrescrevem dados novos** | O consumidor ignora eventos com `versao` menor ou igual à que já tem |
| **Mensagem com erro não trava a fila** | Em erro de processamento, `nack` sem reenfileirar: a mensagem vai para a `<fila>.dlq` |

**Consequência para quem consome:** todo consumidor **deve** ser idempotente e
tolerar receber eventos repetidos.
