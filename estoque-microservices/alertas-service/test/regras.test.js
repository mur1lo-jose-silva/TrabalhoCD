import assert from "node:assert/strict";
import { test } from "node:test";

import { ACOES, avaliar, validarEvento } from "../src/regras.js";

test("abre alerta quando o saldo cai abaixo do minimo", () => {
  assert.equal(avaliar({ saldo_atual: 8, estoque_minimo: 10 }, false), ACOES.ABRIR);
});

test("so atualiza quando ja existe alerta ativo e continua abaixo", () => {
  assert.equal(avaliar({ saldo_atual: 5, estoque_minimo: 10 }, true), ACOES.ATUALIZAR);
});

test("resolve quando o saldo volta ao minimo", () => {
  assert.equal(avaliar({ saldo_atual: 10, estoque_minimo: 10 }, true), ACOES.RESOLVER);
});

test("nada a fazer acima do minimo sem alerta", () => {
  assert.equal(avaliar({ saldo_atual: 50, estoque_minimo: 10 }, false), ACOES.NADA);
});

test("saldo igual ao minimo nao abre alerta", () => {
  assert.equal(avaliar({ saldo_atual: 10, estoque_minimo: 10 }, false), ACOES.NADA);
});

test("minimo zero nunca gera alerta", () => {
  assert.equal(avaliar({ saldo_atual: 0, estoque_minimo: 0 }, false), ACOES.NADA);
});

test("aumento do minimo pode abrir alerta sem movimentacao", () => {
  assert.equal(avaliar({ saldo_atual: 15, estoque_minimo: 20 }, false), ACOES.ABRIR);
});

test("produto removido encerra o alerta ativo", () => {
  assert.equal(avaliar({ saldo_atual: 3, estoque_minimo: 10, ativo: false }, true), ACOES.ENCERRAR);
});

test("produto removido sem alerta ativo nao abre alerta", () => {
  assert.equal(avaliar({ saldo_atual: 3, estoque_minimo: 10, ativo: false }, false), ACOES.NADA);
});

const valido = {
  event_id: "e1",
  tipo: "estoque.atualizado",
  versao: 3,
  dados: { produto_id: "p1", saldo_atual: 8, estoque_minimo: 10 },
};

test("aceita evento valido", () => {
  assert.equal(validarEvento(valido), valido);
});

test("recusa eventos mal formados", () => {
  assert.throws(() => validarEvento(null));
  assert.throws(() => validarEvento({ ...valido, event_id: undefined }));
  assert.throws(() => validarEvento({ ...valido, tipo: "produto.criado" }));
  assert.throws(() => validarEvento({ ...valido, versao: "3" }));
  assert.throws(() => validarEvento({ ...valido, dados: { produto_id: "p1", saldo_atual: 1.5, estoque_minimo: 1 } }));
  assert.throws(() => validarEvento({ ...valido, dados: { ...valido.dados, ativo: "nao" } }));
});
